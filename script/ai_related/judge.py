"""LLM referees. The game contains no rule logic of its own: the secret rules live in the world's
judge.md / oracle.md, and these two classes only ask a model to apply them.

  Judge   - "does anyone have to die now?"  (asked after every action and at the end of every round)
  Oracle  - "is the declared worldview right?"  (asked when a player declares the truth)
"""
import json
import warnings
from dataclasses import dataclass, field

from .client import DeepSeekClient
from .config import SUMMARY_MODEL
from .prompts import DEFAULT, Prompts, fill


@dataclass
class Verdict:
    player: str
    rule: str = ""
    reason: str = ""
    observation: str = ""
    echo: str = ""
    trigger: str = ""


@dataclass
class OracleResult:
    correct: bool
    line: str = ""
    scene: str = ""
    covered: list = field(default_factory=list)
    missing: list = field(default_factory=list)
    contradicted: list = field(default_factory=list)


def _ask_json(client: DeepSeekClient, system: str, user: str, model: str, what: str, attempts: int = 3):
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for _ in range(attempts):
        try:
            data = json.loads(client.chat(messages, model=model, json_mode=True, max_tokens=900, temperature=0).content)
            if isinstance(data, dict):
                return data
        except ValueError:
            continue
    warnings.warn(f"[{what}] no valid json after {attempts} attempts")
    return None


class Judge:
    def __init__(self, client: DeepSeekClient, rules: str, model: str = SUMMARY_MODEL, prompts: Prompts = DEFAULT):
        self.client, self.model = client, model
        self.system = rules + "\n\n" + prompts.text("judge/judge_format")  # the output format, after the world's judge.md
        self.check_action_text = prompts.text("judge/check_action")
        self.check_round_text = prompts.text("judge/check_round")
        self.round_log_empty = prompts.strings("judge")["round_log_empty"]

    def _verdicts(self, user: str, names: set[str]) -> list[Verdict]:
        data = _ask_json(self.client, self.system, user, self.model, "judge")
        if not data:
            return []  # if the judge cannot answer, nobody is punished
        out = []
        for v in data.get("verdicts") or []:
            if isinstance(v, dict) and v.get("violated") and v.get("player") in names:
                out.append(Verdict(v["player"], str(v.get("rule", "")), str(v.get("reason", "")),
                                   str(v.get("observation", "")), str(v.get("echo") or ""), str(v.get("trigger") or "")))
        return out

    def check_action(self, *, state: str, player: str, action_text: str, content: str, names: set[str]) -> list[Verdict]:
        user = fill(self.check_action_text, state=state, player=player, action=action_text, content=content)
        return self._verdicts(user, names)

    def check_round(self, *, state: str, log: str, names: set[str]) -> list[Verdict]:
        user = fill(self.check_round_text, state=state, log=log or self.round_log_empty)
        return self._verdicts(user, names)


class Oracle:
    def __init__(self, client: DeepSeekClient, truth: str, model: str = SUMMARY_MODEL, prompts: Prompts = DEFAULT):
        self.client, self.model = client, model
        self.system = truth + "\n\n" + prompts.text("judge/oracle_format")  # the output format, after the world's oracle.md
        self.request = prompts.text("judge/oracle_request")
        self.silent = prompts.strings("judge")["oracle_silent"]

    def evaluate(self, declaration: str) -> OracleResult:
        user = fill(self.request, declaration=declaration)
        data = _ask_json(self.client, self.system, user, self.model, "oracle")
        if not data:  # cannot decide -> the declaration is not accepted
            return OracleResult(False, line=self.silent)
        lists = {k: [str(x) for x in (data.get(k) or [])] for k in ("covered", "missing", "contradicted")}
        # Trust the lists over the flag: it is right only if nothing is missing or contradicted.
        correct = bool(data.get("correct")) and not lists["missing"] and not lists["contradicted"]
        return OracleResult(correct, str(data.get("line", "")).strip(), str(data.get("scene", "")).strip(), **lists)

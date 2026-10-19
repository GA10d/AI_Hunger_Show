@echo off
rem Starts the launcher with the hunger_show conda env if it exists, otherwise with whatever pythonw is on PATH.
set "PYW=D:\AnacondaData\envs_dirs\hunger_show\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw"
start "" "%PYW%" "%~dp0launcher.pyw"

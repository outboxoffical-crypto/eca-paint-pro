@echo off
REM ----------------------------------------------------------------------
REM Gradle start up script for Windows
REM ----------------------------------------------------------------------
setlocal
set DIRNAME=%~dp0
nset APP_BASE_NAME=%~n0
nset APP_HOME=%DIRNAME%
set CLASSPATH=%APP_HOME%gradle\wrapper\gradle-wrapper.jar
nif not exist "%CLASSPATH%" (
  echo *************************************************************
  echo * WARNING: gradle-wrapper.jar not found in %APP_HOME%gradle\wrapper
  echo * You need to generate the wrapper JAR by running 'gradle wrapper'
  echo * or install Gradle and run '.\gradlew.bat' after the wrapper is generated.
  echo *************************************************************
)

java -cp "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
endlocal


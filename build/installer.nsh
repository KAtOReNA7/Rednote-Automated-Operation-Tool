!include "WordFunc.nsh"
!insertmacro VersionCompare
!insertmacro un.VersionCompare

!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /D /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop $R0
  ${If} $R0 == 0
    SetErrorLevel 1603
    Abort
  ${EndIf}
!macroend

!macro customInit
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R0 != ""
    ${VersionCompare} "${VERSION}" "$R0" $R1
    ${If} $R1 == 2
      SetErrorLevel 1638
      Abort
    ${EndIf}
  ${EndIf}
!macroend

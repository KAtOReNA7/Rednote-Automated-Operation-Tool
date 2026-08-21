!include "WordFunc.nsh"
!insertmacro VersionCompare
!insertmacro un.VersionCompare

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
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

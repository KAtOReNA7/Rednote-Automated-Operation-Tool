!include "WordFunc.nsh"
!insertmacro VersionCompare
!insertmacro un.VersionCompare

!macro customCheckAppRunning
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  StrCpy $R0 2
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) i.R1'
  IntCmp $R1 -1 custom_process_done
  System::Alloc 1024
  Pop $R2
  System::Call '*$R2(i 556)'
  System::Call 'kernel32::Process32FirstW(i R1, i R2) i.R3'
  StrCpy $R0 1
custom_process_loop:
  StrCmp $R3 0 custom_process_close
  System::Call '*$R2(i,i,i,i,i,i,i,i,i,&w260.R4)'
  System::Call 'kernel32::lstrcmpiW(w R4, w "RednoteMysteryOperations.exe") i.R5'
  IntCmp $R5 0 custom_process_found
  System::Call 'kernel32::Process32NextW(i R1, i R2) i.R3'
  Goto custom_process_loop
custom_process_found:
  StrCpy $R0 0
custom_process_close:
  System::Free $R2
  System::Call 'kernel32::CloseHandle(i R1)'
custom_process_done:
  ${If} $R0 != 1
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    SetErrorLevel 1603
    Quit
  ${EndIf}
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customInit
  !insertmacro customCheckAppRunning
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R0 != ""
    ${VersionCompare} "${VERSION}" "$R0" $R1
    ${If} $R1 == 2
      SetErrorLevel 1638
      Abort
    ${EndIf}
  ${EndIf}
!macroend

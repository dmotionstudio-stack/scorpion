; Scorpion's Windows installer: after choosing the folder, a page asks how
; to install. Normal: Scorpion keeps its data in your Windows profile
; (AppData). Portable: it keeps everything (models, chats, settings) in a
; "scorpion-data" folder inside the install folder, so the folder can live on
; a USB stick and nothing is written to the computer (main.js looks for that
; folder next to Scorpion.exe).
!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var ScorpionModeNormal
Var ScorpionModePortable
Var ScorpionPortable

!macro customPageAfterChangeDir
  Page custom ScorpionModePage ScorpionModeLeave
!macroend

Function ScorpionModePage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "How should Scorpion keep its models, chats and settings?"
  Pop $0
  ${NSD_CreateRadioButton} 0 30u 100% 12u "Installed: in your Windows profile (recommended for this computer)"
  Pop $ScorpionModeNormal
  ${NSD_CreateLabel} 12u 44u 95% 20u "Scorpion is installed for you, with a Start menu entry. Your data stays on this computer."
  Pop $0
  ${NSD_CreateRadioButton} 0 70u 100% 12u "Portable: everything in the install folder (for a USB stick)"
  Pop $ScorpionModePortable
  ${NSD_CreateLabel} 12u 84u 95% 28u "Pick a folder on the USB stick on the previous page. Scorpion then keeps all its data in a scorpion-data folder there and runs on any Windows PC you plug the stick into."
  Pop $0
  ${If} ${FileExists} "$INSTDIR\scorpion-data\*.*"
    ${NSD_Check} $ScorpionModePortable
  ${Else}
    ${NSD_Check} $ScorpionModeNormal
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function ScorpionModeLeave
  ${NSD_GetState} $ScorpionModePortable $ScorpionPortable
FunctionEnd

!macro customInstall
  ${If} $ScorpionPortable == ${BST_CHECKED}
    CreateDirectory "$INSTDIR\scorpion-data"
    CreateDirectory "$INSTDIR\scorpion-data\models"
  ${EndIf}
!macroend
!endif

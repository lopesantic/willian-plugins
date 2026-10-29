; Instalador do Willian Plugins (Inno Setup 6).
; Compilar: ISCC.exe installer\willian-plugins.iss  ->  dist\WillianPlugins-Setup-<versão>.exe
; Instala só para o usuário atual (sem administrador) na pasta de extensões CEP do Premiere
; e liga o PlayerDebugMode, que o Premiere exige para painéis não assinados.

#define AppVersion "1.6.0"

[Setup]
AppId={{8F3B6C2E-5A41-4C7E-9B0D-2E7A61C4F950}
AppName=Willian Plugins
AppVersion={#AppVersion}
AppPublisher=Willian
DefaultDirName={userappdata}\Adobe\CEP\extensions\com.willian.plugins
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=WillianPlugins-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Willian Plugins (Premiere)

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[InstallDelete]
; versão nova substitui a antiga por inteiro
Type: filesandordirs; Name: "{app}\*"

[Files]
Source: "..\extension\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.13"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.14"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"
Root: HKCU; Subkey: "Software\Adobe\CSXS.15"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"

[Messages]
FinishedLabel=Pronto. Reinicie o Premiere e abra os painéis em Janela > Extensões.

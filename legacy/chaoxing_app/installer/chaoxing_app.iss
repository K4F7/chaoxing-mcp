#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\build\windows\x64\runner\Release"
#endif
#ifndef OutputDir
  #define OutputDir "..\build"
#endif

[Setup]
AppId={{937AA486-7EE4-4D24-AFB5-D59EA5F1074B}
AppName=学习通待办
AppVersion={#AppVersion}
AppPublisher=K4F7
AppPublisherURL=https://github.com/K4F7/chaoxing-mcp
DefaultDirName={localappdata}\Programs\ChaoxingTodo
DefaultGroupName=学习通待办
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=chaoxing-app-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\chaoxing_app.exe
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
CloseApplicationsFilter=chaoxing_app.exe
RestartApplications=no

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\学习通待办"; Filename: "{app}\chaoxing_app.exe"; WorkingDir: "{app}"

[UninstallDelete]
Type: files; Name: "{userdesktop}\学习通待办.lnk"

[Code]
var
  RunAfterInstallCheckBox: TNewCheckBox;
  CreateDesktopShortcutCheckBox: TNewCheckBox;

function StopAllApplicationInstances: Boolean;
var
  ErrorCode: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\taskkill.exe'),
    '/F /IM chaoxing_app.exe', '', SW_HIDE, ewWaitUntilTerminated,
    ErrorCode) and ((ErrorCode = 0) or (ErrorCode = 128));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopAllApplicationInstances then
    Result := '无法关闭正在运行的学习通待办，请手动退出后重试。';
end;

function InitializeUninstall: Boolean;
begin
  Result := StopAllApplicationInstances;
  if not Result then
    MsgBox('无法关闭正在运行的学习通待办，请手动退出后重试。',
      mbError, MB_OK);
end;

procedure InitializeWizard;
var
  OptionTop: Integer;
begin
  OptionTop := WizardForm.FinishedLabel.Top +
    WizardForm.FinishedLabel.Height + ScaleY(16);

  RunAfterInstallCheckBox := TNewCheckBox.Create(WizardForm);
  RunAfterInstallCheckBox.Parent := WizardForm.FinishedPage;
  RunAfterInstallCheckBox.Left := WizardForm.FinishedLabel.Left;
  RunAfterInstallCheckBox.Top := OptionTop;
  RunAfterInstallCheckBox.Width := WizardForm.FinishedLabel.Width;
  RunAfterInstallCheckBox.Caption := '立即运行学习通待办';
  RunAfterInstallCheckBox.Checked := False;

  CreateDesktopShortcutCheckBox := TNewCheckBox.Create(WizardForm);
  CreateDesktopShortcutCheckBox.Parent := WizardForm.FinishedPage;
  CreateDesktopShortcutCheckBox.Left := WizardForm.FinishedLabel.Left;
  CreateDesktopShortcutCheckBox.Top := OptionTop + ScaleY(28);
  CreateDesktopShortcutCheckBox.Width := WizardForm.FinishedLabel.Width;
  CreateDesktopShortcutCheckBox.Caption := '创建桌面快捷方式';
  CreateDesktopShortcutCheckBox.Checked := False;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU,
      'Software\Microsoft\Windows\CurrentVersion\Run', 'ChaoxingTodo');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  if CurPageID = wpFinished then begin
    if CreateDesktopShortcutCheckBox.Checked then
      CreateShellLink(
        ExpandConstant('{userdesktop}\学习通待办.lnk'),
        '学习通待办', ExpandConstant('{app}\chaoxing_app.exe'), '',
        ExpandConstant('{app}'), ExpandConstant('{app}\chaoxing_app.exe'),
        0, SW_SHOWNORMAL);

    if RunAfterInstallCheckBox.Checked then
      Exec(ExpandConstant('{app}\chaoxing_app.exe'), '',
        ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;

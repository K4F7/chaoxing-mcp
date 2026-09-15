#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\build\windows\x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\build"
#endif

[Setup]
AppId={{B7C31E2A-4F19-4C8A-9D11-2E8F0C4A91D3}
AppName=学习通待办
AppVersion={#AppVersion}
AppPublisher=K4F7
AppPublisherURL=https://github.com/K4F7/chaoxing-mcp
DefaultDirName={localappdata}\Programs\ChaoxingTodo
DefaultGroupName=学习通待办
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=chaoxing-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\chaoxing_windows.exe
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
CloseApplicationsFilter=chaoxing_windows.exe
RestartApplications=no

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\学习通待办"; Filename: "{app}\chaoxing_windows.exe"; WorkingDir: "{app}"

[UninstallDelete]
Type: files; Name: "{userdesktop}\学习通待办.lnk"

[Code]
var
  RunAfterInstallCheckBox: TNewCheckBox;
  CreateDesktopShortcutCheckBox: TNewCheckBox;

function IsWebView2RuntimeInstalled: Boolean;
begin
  Result := RegKeyExists(HKLM,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') or
    RegKeyExists(HKCU,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') or
    FileExists(ExpandConstant('{pf64}\Microsoft\EdgeWebView\Application\msedgewebview2.exe'));
end;

function StopAllApplicationInstances: Boolean;
var
  ErrorCode: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\taskkill.exe'),
    '/F /IM chaoxing_windows.exe', '', SW_HIDE, ewWaitUntilTerminated,
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

function InitializeSetup: Boolean;
begin
  Result := True;
  if not IsWebView2RuntimeInstalled then
    MsgBox('未检测到 WebView2 运行时。内置登录需要 WebView2；请先安装 Microsoft Edge WebView2，再重新运行安装程序。',
      mbInformation, MB_OK);
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
        '学习通待办', ExpandConstant('{app}\chaoxing_windows.exe'), '',
        ExpandConstant('{app}'), ExpandConstant('{app}\chaoxing_windows.exe'),
        0, SW_SHOWNORMAL);

    if RunAfterInstallCheckBox.Checked then
      Exec(ExpandConstant('{app}\chaoxing_windows.exe'), '',
        ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;

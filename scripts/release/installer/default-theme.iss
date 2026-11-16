; 把 foo_ui_webview2 组件与主题安装到用户已有的 foobar2000 2.x（32 位或 64 位），不改 foobar2000 与组件的配置
; foobar2000 发现新的用户界面模块后，会在下次启动时询问使用哪个模块，选择 Webview2 UI 即可运行主题
; 由 scripts/release/build-installer.mjs 准备文件并传入 AppVersion 与 StageDir 后编译

#ifndef AppVersion
  #error 缺少 AppVersion，请用 build-installer.mjs 构建
#endif
#ifndef StageDir
  #error 缺少 StageDir，请用 build-installer.mjs 构建
#endif

[Setup]
AppName=Default Theme
AppVersion={#AppVersion}
AppPublisher=NereaFantasia
; 目录页选择的是目标 foobar2000，文件写入它对应的 profile
DefaultDirName={code:DefaultFoobarDir}
DisableDirPage=no
AppendDefaultDirName=no
DirExistsWarning=no
UsePreviousAppDir=no
DisableProgramGroupPage=yes
; 主题经应用内更新，删除模板目录即完成卸载，因此不登记卸载程序
Uninstallable=no
PrivilegesRequired=lowest
; 只允许 x64 Windows。主题后端的 Node 运行时没有 32 位版本。
; ARM 版 Windows 上的 ARM64EC 版 foobar2000 在 PE 头里同样标为 x64，其组件目录尚未确认
ArchitecturesAllowed=x64os
ShowLanguageDialog=auto
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
OutputBaseFilename=foo-webview-default-theme-setup-{#AppVersion}

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "zh"; MessagesFile: "chinese-simplified.isl"

[Messages]
en.WizardSelectDir=Select the foobar2000 Folder
en.SelectDirDesc=The foo_ui_webview2 component and the theme will be installed into the selected foobar2000.
en.SelectDirLabel3=Select the folder that contains foobar2000.exe.
zh.WizardSelectDir=选择 foobar2000 的位置
zh.SelectDirDesc=foo_ui_webview2 组件与主题将安装到所选的 foobar2000。
zh.SelectDirLabel3=选择 foobar2000.exe 所在的文件夹。

[CustomMessages]
en.NotFoobar=The selected folder does not contain foobar2000.exe.
en.UnknownExe=Setup cannot identify the selected foobar2000.exe.
en.NeedV2=The selected foobar2000 is version %1. The foo_ui_webview2 component requires foobar2000 2.0 or later.
en.FoobarRunning=The selected foobar2000 is running. Exit foobar2000, then click Next.
en.NotWritable=Setup cannot write to %1, where the component and the theme are installed. Run Setup as administrator, or move foobar2000 to a folder you can write to.
en.NoWebView2=Microsoft Edge WebView2 Runtime was not found. The foo_ui_webview2 component requires it.%n%nDownload the WebView2 Runtime installer now? Setup continues either way.
en.ThemeKept=The template "%1" already contains this theme, and its files were kept. To update the theme, use Settings > About in the theme.
en.PickUi=Start foobar2000. When it asks which user interface module to use, select Webview2 UI and confirm. If it does not ask and the interface does not change, set the user interface to Webview2 UI in File > Preferences > Display.
en.PickTemplate=If foobar2000 shows a different theme, select the template "%1" in File > Preferences > Display > WebView2 UI, apply, and restart foobar2000.
en.RunFoobar=Start foobar2000
zh.NotFoobar=所选文件夹中没有 foobar2000.exe。
zh.UnknownExe=无法识别所选的 foobar2000.exe。
zh.NeedV2=所选的 foobar2000 是 %1 版。foo_ui_webview2 组件需要 foobar2000 2.0 或更高版本。
zh.FoobarRunning=所选的 foobar2000 正在运行。请退出 foobar2000，再点击「下一步」。
zh.NotWritable=无法写入组件与主题的安装位置 %1。请以管理员身份运行安装程序，或将 foobar2000 移到可以写入的文件夹。
zh.NoWebView2=未检测到 Microsoft Edge WebView2 运行时，foo_ui_webview2 组件需要它。%n%n是否现在下载 WebView2 运行时的安装程序？无论选择哪项，安装都会继续。
zh.ThemeKept=模板「%1」中已装有此主题，现有文件保持不变。如需更新主题，请使用主题的「设置 > 关于」。
zh.PickUi=启动 foobar2000。出现询问用户界面模块的对话框时，选择 Webview2 UI 并确认。如果没有出现该对话框，界面也没有变化，请在 File > Preferences > Display 中将用户界面改为 Webview2 UI。
zh.PickTemplate=如果 foobar2000 显示的是其他主题，请在 File > Preferences > Display > WebView2 UI 中选择模板「%1」，应用后重启 foobar2000。
zh.RunFoobar=启动 foobar2000

[Files]
; Inno 会比较文件版本，已有同版本或更新的组件时保留原文件
Source: "{#StageDir}\component-x64\*"; DestDir: "{code:ComponentDir}"; Flags: recursesubdirs createallsubdirs; Check: not Is32BitFoobar
Source: "{#StageDir}\component-x86\*"; DestDir: "{code:ComponentDir}"; Flags: recursesubdirs createallsubdirs; Check: Is32BitFoobar
Source: "{#StageDir}\theme\*"; DestDir: "{code:ThemeDir}"; Flags: recursesubdirs createallsubdirs; Check: ShouldInstallTheme

[Run]
Filename: "{app}\foobar2000.exe"; Description: "{cm:RunFoobar}"; Flags: postinstall nowait skipifsilent

[Code]
const
  WEBVIEW2_KEY = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WEBVIEW2_INSTALLER = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
  MACHINE_X64 = $8664;
  MACHINE_X86 = $14C;

var
  ProfileDir: String;
  TemplateName: String;
  Is32Bit: Boolean;
  KeepTheme: Boolean;
  OtherTemplates: Boolean;

{ 64 位与 32 位 foobar2000 的标准安装通常分别位于 Program Files 与 Program Files (x86) }
function DefaultFoobarDir(Param: String): String;
begin
  Result := ExpandConstant('{commonpf64}\foobar2000');
  if not FileExists(Result + '\foobar2000.exe')
    and FileExists(ExpandConstant('{commonpf32}\foobar2000\foobar2000.exe')) then
    Result := ExpandConstant('{commonpf32}\foobar2000');
end;

{ 32 位与 64 位 foobar2000 的标准安装共用同一个 profile，组件目录按位数分开 }
function ComponentDir(Param: String): String;
begin
  if Is32Bit then
    Result := ProfileDir + '\user-components\foo_ui_webview2'
  else
    Result := ProfileDir + '\user-components-x64\foo_ui_webview2';
end;

function ThemeDir(Param: String): String;
begin
  Result := ProfileDir + '\webview-ui\' + TemplateName;
end;

function Is32BitFoobar: Boolean;
begin
  Result := Is32Bit;
end;

function ShouldInstallTheme: Boolean;
begin
  Result := not KeepTheme;
end;

{ 返回 PE 头的 Machine 字段，文件无法读取时返回 0 }
function ExeMachine(const Path: String): Integer;
var
  Data: AnsiString;
  Header: Integer;
begin
  Result := 0;
  if not LoadStringFromFile(Path, Data) or (Length(Data) < $40) then Exit;
  Header := Ord(Data[$3D]) + Ord(Data[$3E]) * $100 + Ord(Data[$3F]) * $10000;
  if Length(Data) < Header + 6 then Exit;
  Result := Ord(Data[Header + 5]) + Ord(Data[Header + 6]) * $100;
end;

function IsRunning(const Exe: String): Boolean;
var
  Locator, Service, Items, Item: Variant;
  I: Integer;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Items := Service.ExecQuery('SELECT ExecutablePath FROM Win32_Process WHERE Name = ''foobar2000.exe''');
    for I := 0 to Items.Count - 1 do
    begin
      Item := Items.ItemIndex(I);
      if not VarIsNull(Item.ExecutablePath) and (CompareText(Item.ExecutablePath, Exe) = 0) then
        Result := True;
    end;
  except
    { 查询进程失败时继续安装：foobar2000 运行期间写入的组件会在下次启动时加载 }
  end;
end;

{ 本主题的完整安装包含版本指针与前端目录，宿主自建的占位模板只有 index.html }
function HasTheme(const Dir: String): Boolean;
begin
  Result := FileExists(Dir + '\current.json') and DirExists(Dir + '\fe');
end;

function HasOtherTemplate(const Base, Name: String): Boolean;
var
  Entry: TFindRec;
begin
  Result := False;
  if not FindFirst(Base + '*', Entry) then Exit;
  try
    repeat
      if (Entry.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and (Entry.Name <> '.') and (Entry.Name <> '..')
        and (CompareText(Entry.Name, Name) <> 0) and FileExists(Base + Entry.Name + '\index.html') then
        Result := True;
    until Result or not FindNext(Entry);
  finally
    FindClose(Entry);
  end;
end;

{ 宿主的活动模板缺省为 default，从未更改过模板的用户把主题放进 default 即可生效。default 已被其他主题占用时改放 default-theme。
  已有本主题的模板保持不变，因为覆盖版本指针可能使主题退回旧版 }
procedure PlanTarget(const Dir: String);
var
  Base: String;
begin
  if FileExists(Dir + '\portable_mode_enabled') then
    ProfileDir := Dir + '\profile'
  else
    ProfileDir := ExpandConstant('{userappdata}\foobar2000-v2');
  Base := ProfileDir + '\webview-ui\';
  KeepTheme := True;
  if HasTheme(Base + 'default') then
    TemplateName := 'default'
  else if HasTheme(Base + 'default-theme') then
    TemplateName := 'default-theme'
  else
  begin
    KeepTheme := False;
    if FileExists(Base + 'default\index.html') then
      TemplateName := 'default-theme'
    else
      TemplateName := 'default';
  end;
  OtherTemplates := HasOtherTemplate(Base, TemplateName);
end;

{ 判断当前权限能否写入 profile 目录：在其中试写临时文件，目录尚未创建时改在最近的已有上级目录中试写。
  便携版位于 Program Files 等受保护的位置时，不提权运行的安装程序无法写入。因此在目录页预先检查，不等到复制文件时才报告拒绝访问 }
function CanWriteProfile: Boolean;
var
  Dir, Parent, Probe: String;
begin
  Dir := ProfileDir;
  while not DirExists(Dir) do
  begin
    Parent := ExtractFileDir(Dir);
    if Parent = Dir then Break;
    Dir := Parent;
  end;
  Probe := AddBackslash(Dir) + 'foo-webview-setup-probe.tmp';
  Result := SaveStringToFile(Probe, '', False);
  if Result then
    DeleteFile(Probe);
end;

function Refuse(const Text: String): Boolean;
begin
  SuppressibleMsgBox(Text, mbError, MB_OK, IDOK);
  Result := False;
end;

{ 组件按所选 foobar2000 的位数选择，目录页显示时尚无法计算所需空间 }
procedure InitializeWizard;
begin
  WizardForm.DiskSpaceLabel.Visible := False;
end;

function InitializeSetup: Boolean;
var
  Version: String;
  Code: Integer;
begin
  Result := True;
  if (RegQueryStringValue(HKLM32, WEBVIEW2_KEY, 'pv', Version) or RegQueryStringValue(HKCU, WEBVIEW2_KEY, 'pv', Version))
    and (Version <> '') and (Version <> '0.0.0.0') then
    Exit;
  if SuppressibleMsgBox(CustomMessage('NoWebView2'), mbConfirmation, MB_YESNO, IDNO) = IDYES then
    ShellExec('open', WEBVIEW2_INSTALLER, '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Dir, Exe, Version: String;
  Machine: Integer;
  VersionMS, VersionLS: Cardinal;
begin
  Result := True;
  if CurPageID <> wpSelectDir then Exit;
  Dir := RemoveBackslashUnlessRoot(WizardDirValue);
  Exe := AddBackslash(Dir) + 'foobar2000.exe';
  Machine := ExeMachine(Exe);
  if not FileExists(Exe) then
    Result := Refuse(CustomMessage('NotFoobar'))
  else if not GetVersionNumbers(Exe, VersionMS, VersionLS) or ((Machine <> MACHINE_X64) and (Machine <> MACHINE_X86)) then
    Result := Refuse(CustomMessage('UnknownExe'))
  else if (VersionMS shr 16) < 2 then
  begin
    Version := Format('%d.%d.%d', [VersionMS shr 16, VersionMS and $FFFF, VersionLS shr 16]);
    Result := Refuse(FmtMessage(CustomMessage('NeedV2'), [Version]));
  end
  else if IsRunning(Exe) then
    Result := Refuse(CustomMessage('FoobarRunning'))
  else
  begin
    Is32Bit := Machine = MACHINE_X86;
    PlanTarget(Dir);
    if not CanWriteProfile then
      Result := Refuse(FmtMessage(CustomMessage('NotWritable'), [ProfileDir]));
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Text: String;
begin
  if CurPageID <> wpFinished then Exit;
  Text := '';
  if KeepTheme then
    Text := FmtMessage(CustomMessage('ThemeKept'), [TemplateName]) + #13#10#13#10;
  Text := Text + CustomMessage('PickUi');
  if (TemplateName <> 'default') or OtherTemplates then
    Text := Text + #13#10#13#10 + FmtMessage(CustomMessage('PickTemplate'), [TemplateName]);
  WizardForm.FinishedLabel.Caption := Text;
  WizardForm.FinishedLabel.AdjustHeight;
  WizardForm.RunList.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(12);
end;

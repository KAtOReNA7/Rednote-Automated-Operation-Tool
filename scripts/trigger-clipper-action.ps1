param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$BrowserProcessId,
  [Parameter(Mandatory = $true)]
  [ValidateSet('chrome', 'edge')]
  [string]$BrowserFamily
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Issue017KeyboardInput
{
    [StructLayout(LayoutKind.Sequential)]
    public struct KeyboardInput
    {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MouseInput
    {
        public int x;
        public int y;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HardwareInput
    {
        public uint message;
        public ushort lowParameter;
        public ushort highParameter;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)]
        public KeyboardInput keyboard;

        [FieldOffset(0)]
        public MouseInput mouse;

        [FieldOffset(0)]
        public HardwareInput hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Input
    {
        public uint type;
        public InputUnion value;
    }

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);

    [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")]
    private static extern uint GetWindowThreadProcessIdWithOwner(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint count, Input[] inputs, int size);

    private static Input Key(ushort virtualKey, uint flags)
    {
        return new Input
        {
            type = 1,
            value = new InputUnion
            {
                keyboard = new KeyboardInput
                {
                    virtualKey = virtualKey,
                    scanCode = 0,
                    flags = flags,
                    time = 0,
                    extraInfo = UIntPtr.Zero
                }
            }
        };
    }

    public static bool SendForegroundUnlock()
    {
        const uint keyUp = 0x0002;
        Input[] inputs = new Input[]
        {
            Key(0x12, 0),
            Key(0x12, keyUp)
        };
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) == inputs.Length;
    }

    public static uint GetWindowProcessId(IntPtr hWnd)
    {
        uint processId;
        GetWindowThreadProcessIdWithOwner(hWnd, out processId);
        return processId;
    }

    public static bool SendActionShortcut()
    {
        const uint keyUp = 0x0002;
        Input[] inputs = new Input[]
        {
            Key(0x12, 0),
            Key(0x10, 0),
            Key(0x59, 0),
            Key(0x59, keyUp),
            Key(0x10, keyUp),
            Key(0x12, keyUp)
        };
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) == inputs.Length;
    }

    public static bool ClickPoint(int x, int y)
    {
        if (!SetCursorPos(x, y)) return false;
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        return true;
    }
}
'@

$browser = Get-Process -Id $BrowserProcessId -ErrorAction Stop
if ($browser.MainWindowHandle -eq [IntPtr]::Zero) {
  throw 'The isolated browser does not own a visible main window.'
}
$shell = New-Object -ComObject WScript.Shell
# Foreground activation is a best-effort visibility hint. Hosted Windows runners
# can deny foreground ownership, so the UI Automation root bound to this exact
# browser handle below remains the authority for the real action.
[void]$shell.AppActivate($BrowserProcessId)
$currentThread = [Issue017KeyboardInput]::GetCurrentThreadId()
$targetThread = [Issue017KeyboardInput]::GetWindowThreadProcessId(
  $browser.MainWindowHandle,
  [IntPtr]::Zero
)
$foregroundWindow = [Issue017KeyboardInput]::GetForegroundWindow()
$foregroundThread = [Issue017KeyboardInput]::GetWindowThreadProcessId(
  $foregroundWindow,
  [IntPtr]::Zero
)
[void][Issue017KeyboardInput]::AttachThreadInput($currentThread, $targetThread, $true)
if ($foregroundThread -ne 0 -and $foregroundThread -ne $targetThread) {
  [void][Issue017KeyboardInput]::AttachThreadInput($currentThread, $foregroundThread, $true)
}
for ($attempt = 0; $attempt -lt 5; $attempt += 1) {
  [void][Issue017KeyboardInput]::ShowWindowAsync($browser.MainWindowHandle, 9)
  [void][Issue017KeyboardInput]::BringWindowToTop($browser.MainWindowHandle)
  if (-not [Issue017KeyboardInput]::SendForegroundUnlock()) {
    throw 'Windows did not accept the foreground activation input.'
  }
  [void][Issue017KeyboardInput]::SetForegroundWindow($browser.MainWindowHandle)
  [void][Issue017KeyboardInput]::SetFocus($browser.MainWindowHandle)
  Start-Sleep -Milliseconds 250
  if ([Issue017KeyboardInput]::GetForegroundWindow() -eq $browser.MainWindowHandle) {
    break
  }
}
$foregroundWindow = [Issue017KeyboardInput]::GetForegroundWindow()
$foregroundOwnerProcessId = [Issue017KeyboardInput]::GetWindowProcessId($foregroundWindow)
if ($foregroundOwnerProcessId -eq [uint32]$browser.Id) {
  if (-not [Issue017KeyboardInput]::SendActionShortcut()) {
    throw 'Windows did not accept the complete extension action shortcut.'
  }
  Start-Sleep -Milliseconds 500
  [void][Issue017KeyboardInput]::AttachThreadInput($currentThread, $targetThread, $false)
  if ($foregroundThread -ne 0 -and $foregroundThread -ne $targetThread) {
    [void][Issue017KeyboardInput]::AttachThreadInput($currentThread, $foregroundThread, $false)
  }
  exit 0
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Find-VisibleNamedElement {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Root,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $Name
  )
  try {
    $match = $Root.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      $nameCondition
    )
    if ($null -ne $match) {
      return $match
    }
  } catch [System.Runtime.InteropServices.COMException] {
    # Some unrelated top-level windows expose a broken UIA subtree. Search each
    # desktop child independently so one inaccessible window cannot abort the
    # exact-name lookup for the isolated browser popup.
  }
  if ($Root -eq [System.Windows.Automation.AutomationElement]::RootElement) {
    $topLevelWindows = $Root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($topLevelWindow in $topLevelWindows) {
      try {
        if (
          [string]::Equals(
            $topLevelWindow.Current.Name,
            $Name,
            [System.StringComparison]::Ordinal
          )
        ) {
          return $topLevelWindow
        }
        $match = $topLevelWindow.FindFirst(
          [System.Windows.Automation.TreeScope]::Descendants,
          $nameCondition
        )
        if ($null -ne $match) {
          return $match
        }
      } catch [System.Runtime.InteropServices.COMException] {
        continue
      }
    }
  }
  return $null
}

function Find-VisibleNameContaining {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Root,
    [Parameter(Mandatory = $true)]
    [string[]]$Fragments
  )

  $elements = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $elements) {
    try {
      if ($element.Current.IsOffscreen) {
        continue
      }
      $name = $element.Current.Name
      $automationId = $element.Current.AutomationId
      foreach ($fragment in $Fragments) {
        if (
          (
            -not [string]::IsNullOrWhiteSpace($name) -and
            $name.IndexOf($fragment, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
          ) -or (
            -not [string]::IsNullOrWhiteSpace($automationId) -and
            $automationId.IndexOf($fragment, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
          )
        ) {
          return $element
        }
      }
    } catch [System.Runtime.InteropServices.COMException] {
      continue
    }
  }
  return $null
}

function Get-VisibleButtonDiagnostics {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Root
  )

  $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    $buttonCondition
  )
  $diagnostics = @()
  foreach ($button in $buttons) {
    if ($diagnostics.Count -ge 24) {
      break
    }
    try {
      if ($button.Current.IsOffscreen) {
        continue
      }
      $name = ([string]$button.Current.Name -replace '[\r\n\t]', ' ').Trim()
      $automationId = ([string]$button.Current.AutomationId -replace '[\r\n\t]', ' ').Trim()
      if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($automationId)) {
        continue
      }
      $diagnostics += [pscustomobject]@{
        name = $name.Substring(0, [Math]::Min($name.Length, 80))
        automationId = $automationId.Substring(0, [Math]::Min($automationId.Length, 80))
      }
    } catch [System.Runtime.InteropServices.COMException] {
      continue
    }
  }
  return ($diagnostics | ConvertTo-Json -Compress)
}

function Invoke-VisibleElement {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Element
  )

  try {
    $invoke = $Element.GetCurrentPattern(
      [System.Windows.Automation.InvokePattern]::Pattern
    )
    $invoke.Invoke()
    return
  } catch {
    $rectangle = $Element.Current.BoundingRectangle
    $x = [int][Math]::Round($rectangle.Left + ($rectangle.Width / 2))
    $y = [int][Math]::Round($rectangle.Top + ($rectangle.Height / 2))
    if (-not [Issue017KeyboardInput]::ClickPoint($x, $y)) {
      throw 'Windows did not accept the toolbar click.'
    }
  }
}

$browserRoot = $null
$browserRootDeadline = [DateTime]::UtcNow.AddSeconds(5)
while ($null -eq $browserRoot -and [DateTime]::UtcNow -lt $browserRootDeadline) {
  $browser.Refresh()
  if ($browser.MainWindowHandle -ne [IntPtr]::Zero) {
    try {
      $browserRoot = [System.Windows.Automation.AutomationElement]::FromHandle(
        $browser.MainWindowHandle
      )
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      $browserRoot = $null
    }
  }
  if ($null -eq $browserRoot) {
    Start-Sleep -Milliseconds 100
  }
}
if ($null -eq $browserRoot) {
  throw 'The isolated browser UI Automation root was not available.'
}
$extensionsChinese = -join @(
  [char]0x6269,
  [char]0x5c55,
  [char]0x7a0b,
  [char]0x5e8f
)
$extensionsEdgeChinese = -join @(
  [char]0x6269,
  [char]0x5c55
)
$extensionNameChinese = -join @(
  [char]0x63a8,
  [char]0x7406,
  [char]0x5c0f,
  [char]0x8bf4,
  [char]0x516c,
  [char]0x5f00,
  [char]0x9875,
  [char]0x9762,
  [char]0x6837,
  [char]0x672c,
  [char]0x6536,
  [char]0x85cf
)
$extensionTitleChinese = -join @(
  [char]0x4fdd,
  [char]0x5b58,
  [char]0x516c,
  [char]0x5f00,
  [char]0x9875,
  [char]0x9762,
  [char]0x6837,
  [char]0x672c
)
$extensionsButton = Find-VisibleNamedElement -Root $browserRoot -Name $extensionsChinese
if ($null -eq $extensionsButton) {
  $extensionsButton = Find-VisibleNamedElement -Root $browserRoot -Name $extensionsEdgeChinese
}
if ($null -eq $extensionsButton) {
  $extensionsButton = Find-VisibleNamedElement -Root $browserRoot -Name 'Extensions'
}
if ($null -eq $extensionsButton) {
  $extensionsButton = Find-VisibleNameContaining `
    -Root $browserRoot `
    -Fragments @($extensionsChinese, $extensionsEdgeChinese, 'Extensions')
}
if ($null -eq $extensionsButton) {
  $buttonDiagnostics = Get-VisibleButtonDiagnostics -Root $browserRoot
  throw "The isolated browser Extensions toolbar button was not found. Visible buttons: $buttonDiagnostics"
}
Invoke-VisibleElement -Element $extensionsButton
Start-Sleep -Milliseconds 500

$extensionAction = $null
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while ($null -eq $extensionAction -and [DateTime]::UtcNow -lt $deadline) {
  $extensionAction = Find-VisibleNamedElement `
    -Root ([System.Windows.Automation.AutomationElement]::RootElement) `
    -Name $extensionNameChinese
  if ($null -eq $extensionAction) {
    $extensionAction = Find-VisibleNamedElement `
      -Root ([System.Windows.Automation.AutomationElement]::RootElement) `
      -Name $extensionTitleChinese
  }
  if ($null -eq $extensionAction) {
    $extensionAction = Find-VisibleNameContaining `
      -Root ([System.Windows.Automation.AutomationElement]::RootElement) `
      -Fragments @($extensionNameChinese, $extensionTitleChinese)
  }
  if ($null -eq $extensionAction) {
    Start-Sleep -Milliseconds 100
  }
}
if ($null -eq $extensionAction) {
  throw 'The exact unpacked extension action was not found in the toolbar menu.'
}
Invoke-VisibleElement -Element $extensionAction
Start-Sleep -Seconds 6
[void][Issue017KeyboardInput]::AttachThreadInput($currentThread, $targetThread, $false)
if ($foregroundThread -ne 0 -and $foregroundThread -ne $targetThread) {
  [void][Issue017KeyboardInput]::AttachThreadInput($currentThread, $foregroundThread, $false)
}

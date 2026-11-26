[CmdletBinding()]
param(
    [Parameter()]
    [int]$Port = 5173,

    [Parameter()]
    [switch]$DesktopApp
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) {
    $ScriptDir = $PSScriptRoot
}
Set-Location -Path $ScriptDir

function Test-PortListening {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [int]$TargetPort
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(350, $false)
        if ($connected -and $client.Connected) {
            $client.EndConnect($async)
            return $true
        }
        return $false
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Start-SonaServer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [int]$TargetPort,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory
    )

    if (Test-PortListening -TargetPort $TargetPort) {
        Write-Output "SONA server is already listening on port $TargetPort."
        return
    }

    $nodeCmd = Get-Command 'node' -ErrorAction SilentlyContinue
    if ($null -eq $nodeCmd) {
        throw [System.IO.FileNotFoundException]::new('Node.js runtime was not found on PATH.')
    }

    $serverPath = Join-Path -Path $WorkingDirectory -ChildPath 'server.mjs'
    if (-not (Test-Path -LiteralPath $serverPath)) {
        throw [System.IO.FileNotFoundException]::new("Missing server entrypoint: $serverPath")
    }

    $argList = @("`"$serverPath`"", '--port', "$TargetPort")
    Start-Process -FilePath $nodeCmd.Source -ArgumentList $argList -WorkingDirectory $WorkingDirectory -WindowStyle Minimized | Out-Null

    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening -TargetPort $TargetPort) {
            Write-Output "Started SONA server on http://localhost:$TargetPort"
            return
        }
        Start-Sleep -Milliseconds 200
    }

    throw [System.TimeoutException]::new("Timed out waiting for SONA server on port $TargetPort.")
}

function Open-SonaClient {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TargetUrl,

        [Parameter()]
        [switch]$UseAppWindow
    )

    if ($UseAppWindow) {
        $browserPaths = @(
            "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
        )
        foreach ($candidate in $browserPaths) {
            if ($candidate -and (Test-Path -LiteralPath $candidate)) {
                Start-Process -FilePath $candidate -ArgumentList "--app=$TargetUrl", '--new-window' | Out-Null
                return
            }
        }
    }

    Start-Process -FilePath $TargetUrl | Out-Null
}

Start-SonaServer -TargetPort $Port -WorkingDirectory $ScriptDir
$appUrl = "http://localhost:$Port"
Open-SonaClient -TargetUrl $appUrl -UseAppWindow:$DesktopApp
Write-Output "SONA launched at $appUrl"

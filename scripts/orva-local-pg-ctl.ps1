# Start/stop disposable local PostgreSQL (127.0.0.1 only).
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Bin = Join-Path $Root 'tools\pgsql-portable\bin'
$Data = Join-Path $Root 'tools\orva-pgdata'
$Log = Join-Path $Data 'pg.log'
$PgCtl = Join-Path $Bin 'pg_ctl.exe'

if (-not (Test-Path $PgCtl)) { throw "Missing $PgCtl — run portable bootstrap first." }

switch ($Action) {
    'start' {
        & $PgCtl -D $Data -l $Log start
    }
    'stop' {
        & $PgCtl -D $Data stop -m fast
    }
    'status' {
        & $PgCtl -D $Data status
        Get-NetTCPConnection -LocalPort 5432 -State Listen -EA SilentlyContinue |
            Select-Object LocalAddress, LocalPort, OwningProcess
    }
}

# =====================================================================
#  WikiMasters Cloud - Lanceur Windows
#  Ouvre la fenêtre Chrome d'une personne quand elle touche « Lancer »
#  sur le site cloud, et la ferme quand elle touche « Arrêter ».
#  Chaque personne a son propre profil Chrome (créé automatiquement).
# =====================================================================
param([string]$Mode = '')

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

# --- Réglages fixes ---
$API        = 'https://djqiebvxomunucoxaslv.supabase.co/rest/v1/rpc/'
$KEY        = 'sb_publishable_7DMTebFuGdNRz-61SmWdzA_rydnA9_8'   # clé publique
$SITE       = 'https://www.wiki-masters.com/pulls?wmcloud=1'
$SCRIPT_URL = 'https://remsko.github.io/wikimasters-cloud/wikimasters-outils.user.js'
$TM_URL     = 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo'
$CLOUD_URL  = 'https://remsko.github.io/wikimasters-cloud/'
$POLL_SEC   = 10     # vérifie les ordres toutes les 10 s
$STOP_GRACE = 60     # après « Arrêter », attend max 60 s que les cartes soient envoyées

$HOME_DIR    = Join-Path $env:LOCALAPPDATA 'WikiMastersCloud'
$PROFILES    = Join-Path $HOME_DIR 'profils'
$CONFIG_FILE = Join-Path $HOME_DIR 'config.json'
New-Item -ItemType Directory -Force -Path $PROFILES | Out-Null

function Say([string]$t, [string]$c = 'Gray') { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $t) -ForegroundColor $c }

# --- Chrome ---
function Find-Chrome {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Safe-Name([string]$u) { return ($u.ToLower() -replace '[^a-z0-9_-]', '_') }
function Profile-Dir([string]$u) { return (Join-Path $PROFILES (Safe-Name $u)) }
function Profile-Ready([string]$u) { return (Test-Path (Join-Path (Profile-Dir $u) 'Default')) }

# Processus Chrome d'un profil (repérés grâce à leur dossier de profil).
function Get-ProfileProcs([string]$u) {
  $dir = Profile-Dir $u
  $all = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue
  return @($all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dir) })
}
function Is-Open([string]$u) { return ((Get-ProfileProcs $u).Count -gt 0) }

function Open-Profile([string]$u, [string[]]$urls) {
  $chromeArgs = @(
    "--user-data-dir=`"$(Profile-Dir $u)`"",
    '--no-first-run', '--no-default-browser-check', '--new-window',
    # Garder la page active même si la fenêtre est cachée derrière une autre :
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'
  ) + $urls
  Start-Process -FilePath $script:CHROME -ArgumentList $chromeArgs | Out-Null
}

function Close-Profile([string]$u) {
  $procs = Get-ProfileProcs $u
  # D'abord une fermeture normale (comme cliquer sur la croix), puis forcée si besoin.
  foreach ($p in $procs) {
    try { $gp = Get-Process -Id $p.ProcessId -ErrorAction Stop; if ($gp.MainWindowHandle -ne 0) { [void]$gp.CloseMainWindow() } } catch {}
  }
  Start-Sleep -Seconds 5
  foreach ($p in (Get-ProfileProcs $u)) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
}

# --- Identifiants admin (mot de passe chiffré par Windows pour ton compte uniquement) ---
function Save-Config($user, [securestring]$sec) {
  @{ user = $user; pass = (ConvertFrom-SecureString $sec) } | ConvertTo-Json | Set-Content -Path $CONFIG_FILE -Encoding UTF8
}
function Load-Config {
  if (-not (Test-Path $CONFIG_FILE)) { return $null }
  try {
    $c = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
    $sec = ConvertTo-SecureString $c.pass
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    return @{ user = $c.user; pass = $plain }
  } catch { return $null }
}

function Rpc([string]$name, $body) {
  $json  = $body | ConvertTo-Json -Compress -Depth 5
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method Post -Uri ($API + $name) -Headers @{ apikey = $KEY } `
           -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 20
}

function Ask-Admin {
  Write-Host ''
  Write-Host 'Identifiants ADMIN des outils WikiMasters (ceux de ton compte) :' -ForegroundColor Cyan
  $u = Read-Host 'Identifiant'
  $s = Read-Host 'Mot de passe' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  try { $r = Rpc 'wm_check_login' @{ p_user = $u; p_pass = $plain } } catch { Say "Serveur injoignable : $($_.Exception.Message)" Red; return $null }
  if (-not $r.ok) { Say ("Refusé : " + $r.reason) Red; return $null }
  if (-not $r.admin) { Say "Ce compte n'est pas admin. Le lanceur a besoin du compte admin." Red; return $null }
  Save-Config $r.user $s
  Say "Identifiants enregistrés (chiffrés pour ta session Windows)." Green
  return @{ user = $r.user; pass = $plain }
}

function Get-Admin {
  $c = Load-Config
  while (-not $c) { $c = Ask-Admin }
  return $c
}

# --- Préparer le profil d'une personne ---
function Prepare-Profile {
  Write-Host ''
  $u = (Read-Host "Identifiant OUTILS de la personne (celui que tu lui as créé)").Trim()
  if (-not $u) { return }
  $first = -not (Profile-Ready $u)
  if (Is-Open $u) { Say "La fenêtre de $u est déjà ouverte." Yellow; return }
  Say "Ouverture du profil Chrome de $u…" Cyan
  if ($first) {
    Open-Profile $u @($TM_URL, $SCRIPT_URL, 'https://www.wiki-masters.com/login')
  } else {
    Open-Profile $u @('https://www.wiki-masters.com/pulls?wmcloud=1')
  }
  Write-Host ''
  Write-Host "Dans la fenêtre qui vient de s'ouvrir :" -ForegroundColor Cyan
  if ($first) {
    Write-Host "  1. Onglet 1 : clique « Ajouter à Chrome » pour installer Tampermonkey."
    Write-Host "  2. Onglet 2 : recharge-le (F5) puis clique « Installer » pour le script."
    Write-Host "     (si Chrome demande le « Mode développeur » : chrome://extensions → en haut à droite)"
  }
  Write-Host "  3. Onglet WikiMasters : connecte-toi au compte DE JEU de $u (ou laisse-le le faire)."
  Write-Host "  4. Va sur https://www.wiki-masters.com/pulls?wmcloud=1"
  Write-Host "     puis connecte le panneau d'outils avec l'identifiant outils « $u »."
  Write-Host "  5. Ferme la fenêtre : c'est prêt. Elle se rouvrira toute seule quand $u touchera « Lancer »."
  Write-Host ''
  Read-Host 'Appuie sur Entrée quand tu as fini' | Out-Null
  if (Is-Open $u) { Say "Fermeture de la fenêtre de $u." Gray; Close-Profile $u }
}

# --- Boucle principale ---
function Run-Loop {
  $admin = Get-Admin
  $state = @{}   # par personne : @{ opened = $true/$false ; stopAt = date }
  $warned = @{}
  Say "Lanceur démarré. Laisse cette fenêtre ouverte (tu peux la réduire). Ctrl+C pour arrêter." Green
  Say "Site : $CLOUD_URL" Gray
  $fails = 0
  while ($true) {
    try {
      $list = Rpc 'wm_launcher_sync' @{ p_admin = $admin.user; p_admin_pass = $admin.pass }
      if ($fails -gt 0) { Say "Connexion au serveur rétablie." Green }
      $fails = 0
    } catch {
      $fails++
      $msg = $_.Exception.Message
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
      if ($msg -match 'admin refus') { Say "Accès admin refusé : saisis à nouveau tes identifiants." Red; Remove-Item $CONFIG_FILE -ErrorAction SilentlyContinue; $admin = Get-Admin; continue }
      if ($fails -eq 1 -or $fails % 30 -eq 0) { Say "Serveur injoignable ($msg), nouvel essai…" Yellow }
      Start-Sleep -Seconds $POLL_SEC; continue
    }

    foreach ($p in @($list)) {
      $u = $p.user
      if (-not $state.ContainsKey($u)) { $state[$u] = @{ opened = $false; stopAt = $null } }
      $s = $state[$u]
      $open = Is-Open $u

      # open_cloud : le PC cloud doit ouvrir les packs (et pas « Mon PC » de la personne).
      $want = $p.desired -eq 'run'
      if ($null -ne $p.open_cloud) { $want = [bool]$p.open_cloud }
      if ($want) {
        $s.stopAt = $null
        if (-not $open) {
          if (-not (Profile-Ready $u)) {
            if (-not $warned[$u]) { Say "$u a demandé « Lancer » mais son profil n'est pas prêt (menu 2)." Yellow; $warned[$u] = $true }
            continue
          }
          Say "> $u : ouverture de sa fenêtre." Green
          Open-Profile $u @($SITE)
          $s.opened = $true
          $s.openedAt = Get-Date
        } elseif ($s.opened -and -not $p.agent_online -and $s.openedAt -and ((Get-Date) - $s.openedAt).TotalMinutes -ge 3 -and -not $warned["co$u"]) {
          Say "(!) $u : fenêtre ouverte mais pas de signal depuis 3 min. Compte WikiMasters ou outils déconnecté ? (menu 2 pour vérifier)" Yellow
          $warned["co$u"] = $true
        }
      } else {
        if ($open -and $s.opened) {
          if (-not $s.stopAt) {
            $s.stopAt = Get-Date
            if ($p.desired -eq 'run') { Say "[] $u : son propre PC a repris la main, envoi des dernières cartes…" Cyan }
            else { Say "[] $u : arrêt demandé, envoi des dernières cartes…" Cyan }
          }
          $waited = ((Get-Date) - $s.stopAt).TotalSeconds
          if ((-not $p.running -and $waited -ge 15) -or $waited -ge $STOP_GRACE) {
            Say "[] $u : fermeture de sa fenêtre." Cyan
            Close-Profile $u
            $s.opened = $false; $s.stopAt = $null; $warned.Remove("co$u")
          }
        }
      }
    }
    Start-Sleep -Seconds $POLL_SEC
  }
}

function Install-Startup {
  $startup = [Environment]::GetFolderPath('Startup')
  $bat = Join-Path $PSScriptRoot 'WikiMasters-Cloud.bat'
  $lnk = Join-Path $startup 'WikiMasters Cloud.lnk'
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($lnk)
  $sc.TargetPath = $bat
  $sc.Arguments = 'start'
  $sc.WorkingDirectory = $PSScriptRoot
  $sc.WindowStyle = 7   # réduite
  $sc.Save()
  Say "Le lanceur démarrera tout seul à l'ouverture de Windows." Green
}

# --- Menu ---
$script:CHROME = Find-Chrome
if (-not $script:CHROME) { Say "Google Chrome est introuvable sur ce PC. Installe-le puis relance." Red; Read-Host 'Entrée pour quitter' | Out-Null; exit 1 }

if ($Mode -eq 'start') { Run-Loop; exit }

while ($true) {
  Write-Host ''
  Write-Host '=========== WikiMasters Cloud ===========' -ForegroundColor Green
  Write-Host '  1. Démarrer le cloud (laisser tourner)'
  Write-Host "  2. Préparer / ouvrir le profil d'une personne"
  Write-Host '  3. Lancer le cloud au démarrage de Windows'
  Write-Host '  4. Changer mes identifiants admin'
  Write-Host '  5. Voir les profils préparés'
  Write-Host '  0. Quitter'
  $c = Read-Host 'Choix'
  switch ($c) {
    '1' { Run-Loop }
    '2' { Prepare-Profile }
    '3' { Install-Startup }
    '4' { Remove-Item $CONFIG_FILE -ErrorAction SilentlyContinue; [void](Get-Admin) }
    '5' {
      $dirs = Get-ChildItem $PROFILES -Directory -ErrorAction SilentlyContinue
      if (-not $dirs) { Say 'Aucun profil pour le moment.' Gray }
      foreach ($d in $dirs) { Write-Host ("  - {0}{1}" -f $d.Name, $(if (Is-Open $d.Name) { '  (fenêtre ouverte)' } else { '' })) }
    }
    '0' { exit }
  }
}

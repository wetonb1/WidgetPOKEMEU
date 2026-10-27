# tools/medir.ps1 — mede CPU e RAM do widget (árvore inteira de processos).
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Cenario A -Variante base
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\medir.ps1 -Anexar -Cenario B
#
# Sem -Anexar: abre o widget (o mesmo electron.exe que o "npx electron ." usa, via
#   tools\cenario.js), espera -Aquecer segundos, mede -Segundos e fecha. Repete -Rodadas vezes.
#   O widget roda dentro de um Job Object do Windows, que soma a CPU de TODOS os processos
#   que passaram por ele, inclusive os PowerShell rápidos que nascem e morrem entre amostras.
# Com -Anexar: mede o widget já aberto (achado pela linha de comando). Os processos que
#   ele criar daqui em diante entram no job; os que já existiam são amostrados a cada 2 s.
#   Para o .exe empacotado: -Anexar -Processo "MeuWidget.exe".
#
# Cenários: A = ocioso (música pausada)
#           B = música tocando (com visualizador)
#           D = ocioso depois de ter tocado música (captura de áudio já criada; música pausada)
# Cada rodada vira uma linha em tools\resultados.csv, mais uma linha "mediana".
param(
    [int]$Segundos = 60,
    [int]$Aquecer = 20,
    [switch]$Anexar,
    [ValidateSet('A', 'B', 'D')]
    [string]$Cenario = 'A',
    [string]$Variante = 'base',
    [int]$Rodadas = 3,
    [string]$Processo = ""   # com -Anexar: nome do .exe (padrão: o electron.exe do projeto)
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $raiz 'node_modules\electron\dist\electron.exe'
$csv = Join-Path $PSScriptRoot 'resultados.csv'
$nucleos = [Environment]::ProcessorCount
$inv = [Globalization.CultureInfo]::InvariantCulture

# ---------- Job Object (P/Invoke) ----------
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JobMedidor {
    [StructLayout(LayoutKind.Sequential)]
    struct CONTABIL { public long User, Kernel, PerUser, PerKernel; public uint Faltas, Total, Ativos, Terminados; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO { public int cb; public string r, d, t; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, hin, hout, herr; }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCINFO { public IntPtr hProcess, hThread; public int pid, tid; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
    [DllImport("kernel32.dll")] static extern bool QueryInformationJobObject(IntPtr job, int cls, out CONTABIL info, int len, IntPtr ret);
    [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool resultado);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int acesso, bool herda, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool herda, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCINFO pi);

    public static IntPtr Job = CreateJobObject(IntPtr.Zero, null);

    // CPU (ms) somada de todos os processos que já passaram pelo job
    public static double CpuMs() {
        CONTABIL c;
        QueryInformationJobObject(Job, 1, out c, Marshal.SizeOf(typeof(CONTABIL)), IntPtr.Zero);
        return (c.User + c.Kernel) / 10000.0;
    }

    // Inicia um processo já dentro do job (suspenso -> job -> continua)
    public static int Iniciar(string exe, string linha, string pasta) {
        var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        PROCINFO pi;
        if (!CreateProcess(exe, linha, IntPtr.Zero, IntPtr.Zero, false, 0x4, IntPtr.Zero, pasta, ref si, out pi))
            throw new Exception("CreateProcess falhou: " + Marshal.GetLastWin32Error());
        AssignProcessToJobObject(Job, pi.hProcess);
        ResumeThread(pi.hThread);
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
        return pi.pid;
    }

    // Coloca um processo já existente no job (pode falhar se ele estiver em outro job)
    public static bool Anexar(int pid) {
        IntPtr h = OpenProcess(0x1101, false, pid);
        if (h == IntPtr.Zero) return false;
        bool ok = AssignProcessToJobObject(Job, h);
        CloseHandle(h);
        return ok;
    }

    // true se o processo está no job (ou num job aninhado dentro dele)
    public static bool NoJob(int pid) {
        IntPtr h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero) return false;
        bool r; IsProcessInJob(h, Job, out r);
        CloseHandle(h);
        return r;
    }
}
'@

# ---------- árvore de processos ----------
# Todos os descendentes do processo principal (GPU, renderizador, utilitários,
# PowerShell da música...). Confere a data de criação contra PID reciclado.
function Get-Arvore([int]$principal) {
    $todos = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate)
    $porPai = @{}
    foreach ($p in $todos) {
        $k = [int]$p.ParentProcessId
        if (-not $porPai.ContainsKey($k)) { $porPai[$k] = New-Object System.Collections.ArrayList }
        [void]$porPai[$k].Add($p)
    }
    $raizProc = $todos | Where-Object { $_.ProcessId -eq $principal } | Select-Object -First 1
    if (-not $raizProc) { return @() }
    $resultado = New-Object System.Collections.ArrayList
    $fila = New-Object System.Collections.Queue
    $fila.Enqueue($raizProc)
    while ($fila.Count -gt 0) {
        $atual = $fila.Dequeue()
        [void]$resultado.Add([int]$atual.ProcessId)
        if ($porPai.ContainsKey([int]$atual.ProcessId)) {
            foreach ($f in $porPai[[int]$atual.ProcessId]) {
                if ($f.CreationDate -ge $atual.CreationDate) { $fila.Enqueue($f) }
            }
        }
    }
    return $resultado.ToArray()
}

function Achar-Principal {
    if ($Processo) {
        $lista = @(Get-CimInstance Win32_Process -Filter "Name='$Processo'" |
            Where-Object { $_.CommandLine -notmatch '--type=' })
    } else {
        $lista = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
            Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type=' })
    }
    if ($lista.Count -eq 0) { throw 'Widget não encontrado. Abra com "npm start" antes de usar -Anexar.' }
    if ($lista.Count -gt 1) { Write-Warning "Há $($lista.Count) widgets abertos; medindo o mais antigo." }
    return [int]($lista | Sort-Object CreationDate | Select-Object -First 1).ProcessId
}

# Status da música no Windows (para conferir o cenário)
function Status-Musica {
    try {
        $s = powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raiz 'app\media.ps1') -Action info | ConvertFrom-Json
        if ($s.status) { return [string]$s.status } else { return 'sem sessão' }
    } catch { return 'desconhecido' }
}

# ---------- uma janela de medição ----------
function Medir-Janela([int]$principal) {
    $jaVistos = @{}      # pid -> CPU (ms) no início (só processos fora do job)
    $ultimo = @{}        # pid -> última CPU (ms) lida
    $noJob = @{}         # pid -> está no job?
    $somaWs = 0.0; $somaPriv = 0.0; $amostras = 0; $maxProc = 0

    $amostrar = {
        param($inicio)
        $pids = Get-Arvore $principal
        $ws = 0.0; $priv = 0.0
        foreach ($id in $pids) {
            $p = Get-Process -Id $id -ErrorAction SilentlyContinue
            if (-not $p) { continue }
            $ws += $p.WorkingSet64; $priv += $p.PrivateMemorySize64
            if (-not $noJob.ContainsKey($id)) { $noJob[$id] = [JobMedidor]::NoJob($id) }
            if ($noJob[$id]) { continue }
            $cpu = $p.TotalProcessorTime.TotalMilliseconds
            if (-not $jaVistos.ContainsKey($id)) { $jaVistos[$id] = $(if ($inicio) { $cpu } else { 0.0 }) }
            $ultimo[$id] = $cpu
        }
        return @($ws, $priv, $pids.Count)
    }

    $jobInicio = [JobMedidor]::CpuMs()
    $relogio = [Diagnostics.Stopwatch]::StartNew()
    $r = & $amostrar $true
    $somaWs += $r[0]; $somaPriv += $r[1]; $amostras++; $maxProc = [Math]::Max($maxProc, $r[2])
    while ($relogio.Elapsed.TotalSeconds -lt $Segundos) {
        Start-Sleep -Milliseconds ([Math]::Max(0, 2000 - ($relogio.ElapsedMilliseconds % 2000)))
        $r = & $amostrar $false
        $somaWs += $r[0]; $somaPriv += $r[1]; $amostras++; $maxProc = [Math]::Max($maxProc, $r[2])
    }
    $tempoMs = $relogio.Elapsed.TotalMilliseconds
    $cpuJob = [JobMedidor]::CpuMs() - $jobInicio
    $cpuFora = 0.0
    foreach ($id in $ultimo.Keys) { $cpuFora += $ultimo[$id] - $jaVistos[$id] }

    $cpuNucleo = ($cpuJob + $cpuFora) / $tempoMs * 100
    return [pscustomobject]@{
        CpuNucleo = $cpuNucleo
        CpuTotal  = $cpuNucleo / $nucleos
        WsMB      = $somaWs / $amostras / 1MB
        PrivMB    = $somaPriv / $amostras / 1MB
        Processos = $maxProc
        Metodo    = $(if ($cpuFora -gt 0) { 'job+amostras' } else { 'job' })
    }
}

function Mediana($valores) {
    $v = @($valores | Sort-Object)
    if ($v.Count % 2) { return $v[[int][Math]::Floor($v.Count / 2)] }
    return ($v[$v.Count / 2 - 1] + $v[$v.Count / 2]) / 2
}

# A música pode parar no meio (fim da playlist): rodada de B sem música não vale
function Conferir-Cenario {
    if ($Cenario -eq 'B' -and (Status-Musica) -ne 'Playing') { throw 'A música parou durante a rodada; repita a medição.' }
}

function Gravar($r, $rodada) {
    if (-not (Test-Path $csv)) {
        'data,cenario,variante,rodada,segundos,cpu_nucleo_pct,cpu_total_pct,ws_mb,privada_mb,processos,metodo' |
            Out-File $csv -Encoding utf8
    }
    $linha = [string]::Format($inv, '{0},{1},{2},{3},{4},{5:F2},{6:F2},{7:F1},{8:F1},{9},{10}',
        (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Cenario, $Variante, $rodada, $Segundos,
        $r.CpuNucleo, $r.CpuTotal, $r.WsMB, $r.PrivMB, $r.Processos, $r.Metodo)
    Add-Content $csv $linha -Encoding utf8
    Write-Host ([string]::Format($inv, '  rodada {0}: CPU {1:F1}% de 1 núcleo ({2:F2}% do total) | RAM WS {3:F0} MB, privada {4:F0} MB | {5} processos',
        $rodada, $r.CpuNucleo, $r.CpuTotal, $r.WsMB, $r.PrivMB, $r.Processos))
}

# ---------- execução ----------
$musica = Status-Musica
Write-Host "Cenário $Cenario, variante '$Variante', $Rodadas rodada(s) de $Segundos s (aquecimento $Aquecer s). Música: $musica"
if ($Cenario -eq 'B' -and $musica -ne 'Playing') { throw 'Cenário B precisa de música TOCANDO.' }
if ($Cenario -ne 'B' -and $musica -eq 'Playing') { throw "Cenário $Cenario precisa da música PAUSADA (ou sem player)." }

$resultados = @()
if ($Anexar) {
    $principal = Achar-Principal
    foreach ($id in (Get-Arvore $principal)) { [void][JobMedidor]::Anexar($id) } # os que puderem
    Write-Host "Anexado ao widget (PID $principal). Aquecendo $Aquecer s..."
    Start-Sleep -Seconds $Aquecer
    for ($i = 1; $i -le $Rodadas; $i++) {
        $r = Medir-Janela $principal
        Conferir-Cenario
        Gravar $r $i
        $resultados += $r
    }
} else {
    $env:ELECTRON_RUN_AS_NODE = $null    # garante Electron de verdade, não modo Node
    $env:WIDGET_CENARIO = $Cenario
    for ($i = 1; $i -le $Rodadas; $i++) {
        $principal = [JobMedidor]::Iniciar($exe, "`"$exe`" tools\cenario.js", $raiz)
        Start-Sleep -Seconds $Aquecer
        try {
            $r = Medir-Janela $principal
            Conferir-Cenario
            Gravar $r $i
            $resultados += $r
        } finally {
            & taskkill.exe /PID $principal /T /F 2>&1 | Out-Null
            Start-Sleep -Seconds 3
        }
    }
}

$m = [pscustomobject]@{
    CpuNucleo = Mediana ($resultados | ForEach-Object CpuNucleo)
    CpuTotal  = Mediana ($resultados | ForEach-Object CpuTotal)
    WsMB      = Mediana ($resultados | ForEach-Object WsMB)
    PrivMB    = Mediana ($resultados | ForEach-Object PrivMB)
    Processos = ($resultados | Measure-Object Processos -Maximum).Maximum
    Metodo    = ($resultados | Select-Object -First 1).Metodo
}
Write-Host '  ---'
Gravar $m 'mediana'

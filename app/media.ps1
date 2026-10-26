# media.ps1 — lê e controla a sessão de mídia do Windows (SMTC) via WinRT.
# Uso: powershell -NoProfile -File media.ps1 -Action info [-Thumb]
#      powershell -NoProfile -File media.ps1 -Action playpause|next|prev
#      powershell -NoProfile -File media.ps1 -Action servidor
# Nos modos avulsos imprime UM JSON compacto em UTF-8 (sem sessão ou com erro: {}).
# No modo servidor (o que o widget usa) fica aberto: lê um comando por linha na
# entrada padrão e responde uma linha de JSON por comando. Assim o PowerShell e
# o WinRT carregam uma vez só, em vez de a cada consulta (~2 s de CPU cada).
#   Comandos: info | info-capa | playpause | next | prev | processos | telacheia
#             | volume | volume-set N (0-100) | mudo-set 0|1
#             | vidro HWND L A RAIO (desfoque + cantos) | cantos HWND L A RAIO
#             | startapps (apps do Menu Iniciar) | janelas (programas abertos) | sair
param(
    [ValidateSet('info', 'playpause', 'next', 'prev', 'servidor')]
    [string]$Action = 'info',
    [switch]$Thumb
)

$ErrorActionPreference = 'Stop'
$saida = [Console]::OpenStandardOutput()
$inv = [Globalization.CultureInfo]::InvariantCulture

# Escreve o texto em UTF-8 direto no stdout (independe da página de código do console)
function Escrever([string]$texto) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($texto)
    $saida.Write($bytes, 0, $bytes.Length)
    $saida.Flush()
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    # Padrão conhecido: pega WindowsRuntimeSystemExtensions.AsTask<T>(IAsyncOperation<T>)
    # por reflexão para conseguir esperar operações assíncronas WinRT no PowerShell 5.1
    $asTaskGenerico = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1

    function Aguardar($operacao, [Type]$tipo) {
        $tarefa = $asTaskGenerico.MakeGenericMethod($tipo).Invoke($null, @($operacao))
        $tarefa.Wait(5000) | Out-Null
        $tarefa.Result
    }

    # Carrega os tipos WinRT
    $tipoGerente = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $tipoProps = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $tipoStream = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $paraStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod(
        'AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

    $gerente = Aguardar ($tipoGerente::RequestAsync()) $tipoGerente

    # Metadados + status (+ capa em data URI base64, se pedida). Sem sessão: {}
    function Ler-Info([bool]$comCapa) {
        $sessao = $gerente.GetCurrentSession()
        if ($null -eq $sessao) { return '{}' }
        $props = Aguardar ($sessao.TryGetMediaPropertiesAsync()) $tipoProps
        $info = [ordered]@{
            title  = [string]$props.Title
            artist = [string]$props.Artist
            album  = [string]$props.AlbumTitle
            status = [string]$sessao.GetPlaybackInfo().PlaybackStatus
        }
        if ($comCapa -and $null -ne $props.Thumbnail) {
            try {
                $stream = Aguardar ($props.Thumbnail.OpenReadAsync()) $tipoStream
                # AsStreamForRead chamado por reflexão: o PowerShell não converte o
                # objeto COM para IInputStream sozinho, mas a reflexão do .NET sim
                $netStream = $paraStream.Invoke($null, @($stream))
                $memoria = New-Object System.IO.MemoryStream
                $netStream.CopyTo($memoria)
                $netStream.Dispose()
                $mime = if ($stream.ContentType) { $stream.ContentType } else { 'image/jpeg' }
                $info.thumb = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($memoria.ToArray())
            } catch {
                # sem capa: segue só com o texto
            }
        }
        return (ConvertTo-Json $info -Compress)
    }

    # play/pause, próxima, anterior. Responde {}
    function Executar([string]$acao) {
        $sessao = $gerente.GetCurrentSession()
        if ($null -eq $sessao) { return '{}' }
        switch ($acao) {
            'playpause' { Aguardar ($sessao.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
            'next'      { Aguardar ($sessao.TrySkipNextAsync()) ([bool]) | Out-Null }
            'prev'      { Aguardar ($sessao.TrySkipPreviousAsync()) ([bool]) | Out-Null }
        }
        return '{}'
    }

    # Processos: [{"n":nome,"c":%CPU do total desde a última chamada,"m":RAM em KB}, ...]
    # Uma única chamada nativa (NtQuerySystemInformation, a mesma fonte do Gerenciador
    # de Tarefas) traz todos os processos com tempo de CPU e memória, sem abrir cada
    # um. Em PowerShell puro isso custava ~770 ms de CPU por leitura; assim, poucos ms.
    # O C# só é compilado no modo servidor (uma vez, quando o widget abre).
    function Listar-Processos { return [ListaProcessos]::Json() }
    if ($Action -eq 'servidor') {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class ListaProcessos {
    [StructLayout(LayoutKind.Sequential)]
    struct UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }

    // SYSTEM_PROCESS_INFORMATION (só até WorkingSetSize, que é o que usamos)
    [StructLayout(LayoutKind.Sequential)]
    struct SPI {
        public uint NextEntryOffset, NumberOfThreads;
        public long WorkingSetPrivateSize;
        public uint HardFaultCount, NumberOfThreadsHighWatermark;
        public ulong CycleTime;
        public long CreateTime, UserTime, KernelTime;
        public UNICODE_STRING ImageName;
        public int BasePriority;
        public IntPtr UniqueProcessId, InheritedFromUniqueProcessId;
        public uint HandleCount, SessionId;
        public IntPtr UniqueProcessKey, PeakVirtualSize, VirtualSize;
        public uint PageFaultCount;
        public IntPtr PeakWorkingSetSize, WorkingSetSize;
    }

    [DllImport("ntdll.dll")]
    static extern int NtQuerySystemInformation(int classe, IntPtr buffer, int tamanho, out int necessario);

    static Dictionary<string, long> anterior = new Dictionary<string, long>();
    static Stopwatch relogio = Stopwatch.StartNew();
    static double msAnterior = 0;
    static int tamanho = 1 << 20;

    public static string Json() {
        double agora = relogio.Elapsed.TotalMilliseconds;
        double dt = agora - msAnterior;
        msAnterior = agora;
        int nucleos = Environment.ProcessorCount;

        IntPtr buf = IntPtr.Zero;
        try {
            while (true) {
                buf = Marshal.AllocHGlobal(tamanho);
                int necessario;
                int st = NtQuerySystemInformation(5, buf, tamanho, out necessario); // 5 = SystemProcessInformation
                if (st == 0) break;
                Marshal.FreeHGlobal(buf); buf = IntPtr.Zero;
                if ((uint)st != 0xC0000004) return "[]";                          // não é "buffer pequeno"
                tamanho = Math.Max(tamanho * 2, necessario + 65536);
            }
            var novo = new Dictionary<string, long>();
            var sb = new StringBuilder("[");
            long pos = 0;
            bool primeiro = true;
            while (true) {
                IntPtr p = new IntPtr(buf.ToInt64() + pos);
                SPI s = (SPI)Marshal.PtrToStructure(p, typeof(SPI));
                long pid = s.UniqueProcessId.ToInt64();
                string nome = pid == 0 ? "Idle"
                    : (s.ImageName.Buffer == IntPtr.Zero ? "System" : Marshal.PtrToStringUni(s.ImageName.Buffer, s.ImageName.Length / 2));
                if (nome.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) nome = nome.Substring(0, nome.Length - 4);
                // chave com a data de criação: um PID reciclado não herda a CPU de outro processo
                string chave = pid + ":" + s.CreateTime;
                long tempo = s.UserTime + s.KernelTime; // unidades de 100 ns
                novo[chave] = tempo;
                double cpu = 0;
                long antes;
                if (dt > 0 && anterior.TryGetValue(chave, out antes)) {
                    cpu = Math.Max(0, (tempo - antes) / 10000.0 / dt / nucleos * 100);
                }
                if (!primeiro) sb.Append(',');
                primeiro = false;
                sb.Append("{\"n\":\"").Append(nome.Replace("\\", "\\\\").Replace("\"", "\\\""))
                  .Append("\",\"c\":").Append(cpu.ToString("0.###", CultureInfo.InvariantCulture))
                  .Append(",\"m\":").Append(s.WorkingSetSize.ToInt64() / 1024).Append('}');
                if (s.NextEntryOffset == 0) break;
                pos += s.NextEntryOffset;
            }
            anterior = novo;
            return sb.Append(']').ToString();
        } finally {
            if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
        }
    }
}

// Há um app em tela cheia? (janela em primeiro plano cobrindo o monitor inteiro;
// a área de trabalho e a barra de tarefas não contam)
public static class TelaCheia {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);

    public static bool Ativa() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return false;
        var classe = new StringBuilder(64);
        GetClassName(h, classe, 64);
        string c = classe.ToString();
        if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return false;
        RECT r;
        if (!GetWindowRect(h, out r)) return false;
        var mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
        return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
    }
}

// Volume geral do Windows (Core Audio / IAudioEndpointVolume): o mesmo dos botões
// de volume do teclado, vale para qualquer player. Acha o dispositivo de saída
// padrão a cada chamada, então acompanha se você trocar de fone ou caixa.
public static class VolumeSistema {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr p);
        int UnregisterControlChangeNotify(IntPtr p);
        int GetChannelCount(out uint n);
        int SetMasterVolumeLevel(float db, ref Guid ctx);
        int SetMasterVolumeLevelScalar(float nivel, ref Guid ctx);
        int GetMasterVolumeLevel(out float db);
        int GetMasterVolumeLevelScalar(out float nivel);
        int SetChannelVolumeLevel(uint c, float db, ref Guid ctx);
        int SetChannelVolumeLevelScalar(uint c, float nivel, ref Guid ctx);
        int GetChannelVolumeLevel(uint c, out float db);
        int GetChannelVolumeLevelScalar(uint c, out float nivel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mudo, ref Guid ctx);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mudo);
    }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        int Activate(ref Guid iid, int clsCtx, IntPtr pars, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int fluxo, int mascara, out IntPtr dispositivos);
        int GetDefaultAudioEndpoint(int fluxo, int funcao, out IMMDevice dispositivo);
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorCom { }

    static IAudioEndpointVolume Ponto() {
        var enumerador = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice dispositivo;
        Marshal.ThrowExceptionForHR(enumerador.GetDefaultAudioEndpoint(0, 1, out dispositivo)); // 0 = saída, 1 = multimídia
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object ponto;
        Marshal.ThrowExceptionForHR(dispositivo.Activate(ref iid, 23, IntPtr.Zero, out ponto)); // 23 = CLSCTX_ALL
        Marshal.ReleaseComObject(dispositivo);
        Marshal.ReleaseComObject(enumerador);
        return (IAudioEndpointVolume)ponto;
    }

    // {"v":0-100,"m":mudo?}
    public static string Json() {
        var p = Ponto();
        try {
            float v; bool m;
            Marshal.ThrowExceptionForHR(p.GetMasterVolumeLevelScalar(out v));
            Marshal.ThrowExceptionForHR(p.GetMute(out m));
            return "{\"v\":" + (int)Math.Round(v * 100) + ",\"m\":" + (m ? "true" : "false") + "}";
        } finally { Marshal.ReleaseComObject(p); }
    }

    // Como no Windows, aumentar o volume tira do mudo
    public static string Definir(int v) {
        v = Math.Max(0, Math.Min(100, v));
        var p = Ponto();
        try {
            Guid ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(p.SetMasterVolumeLevelScalar(v / 100f, ref ctx));
            if (v > 0) p.SetMute(false, ref ctx);
        } finally { Marshal.ReleaseComObject(p); }
        return Json();
    }

    public static string Mudo(bool mudo) {
        var p = Ponto();
        try {
            Guid ctx = Guid.Empty;
            Marshal.ThrowExceptionForHR(p.SetMute(mudo, ref ctx));
        } finally { Marshal.ReleaseComObject(p); }
        return Json();
    }
}

// Estilo "iOS": desfoque REAL do que está atrás da janela (o mesmo efeito do
// Windows 10 que programas como o TranslucentTB usam) e cantos arredondados.
// Funciona a partir de outro processo: o widget manda o identificador (HWND).
public static class Vidro {
    [StructLayout(LayoutKind.Sequential)] struct ACCENT { public int Estado, Flags, Cor, Anim; }
    [StructLayout(LayoutKind.Sequential)] struct DADOS { public int Atributo; public IntPtr Dados; public int Tamanho; }
    [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr h, ref DADOS d);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redesenhar);

    // 3 = ACCENT_ENABLE_BLURBEHIND (desfoque); 0 = desligado
    public static bool Desfoque(long hwnd, bool ligar) {
        var ac = new ACCENT { Estado = ligar ? 3 : 0 };
        int t = Marshal.SizeOf(ac);
        IntPtr p = Marshal.AllocHGlobal(t);
        try {
            Marshal.StructureToPtr(ac, p, false);
            var d = new DADOS { Atributo = 19, Dados = p, Tamanho = t }; // 19 = WCA_ACCENT_POLICY
            return SetWindowCompositionAttribute(new IntPtr(hwnd), ref d) != 0;
        } finally { Marshal.FreeHGlobal(p); }
    }

    // recorta a janela num retângulo de cantos redondos (em pixels da tela)
    public static bool Cantos(long hwnd, int l, int a, int raio) {
        IntPtr rgn = CreateRoundRectRgn(0, 0, l + 1, a + 1, raio * 2, raio * 2);
        return SetWindowRgn(new IntPtr(hwnd), rgn, true) != 0; // o Windows fica dono da região
    }
}
'@
    }

    # Apps do Menu Iniciar (inclusive os da Microsoft Store): [{"n":nome,"id":AppID}]
    function Listar-StartApps {
        $itens = @(Get-StartApps | Where-Object { $_.Name -and $_.AppID } | ForEach-Object { [ordered]@{ n = [string]$_.Name; id = [string]$_.AppID } })
        if ($itens.Count -eq 0) { return '[]' }
        return (ConvertTo-Json $itens -Compress)
    }

    # Programas com janela aberta: [{"n":nome,"p":caminho do .exe}]
    function Listar-Janelas {
        $vistos = @{}
        $itens = foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle })) {
            $caminho = $null
            try { $caminho = $p.Path } catch { }
            if (-not $caminho -or $vistos.ContainsKey($caminho)) { continue }
            $vistos[$caminho] = $true
            $nome = $p.Description
            if (-not $nome) { $nome = $p.ProcessName }
            [ordered]@{ n = [string]$nome; p = [string]$caminho }
        }
        $itens = @($itens)
        if ($itens.Count -eq 0) { return '[]' }
        return (ConvertTo-Json $itens -Compress)
    }

    if ($Action -eq 'servidor') {
        while ($true) {
            $linha = [Console]::In.ReadLine()
            if ($null -eq $linha -or $linha -eq 'sair') { break }  # o widget fechou
            try {
                $resposta = switch ($linha.Trim()) {
                    'info'      { Ler-Info $false }
                    'info-capa' { Ler-Info $true }
                    'processos' { Listar-Processos }
                    'telacheia' { if ([TelaCheia]::Ativa()) { 'true' } else { 'false' } }
                    'volume'    { [VolumeSistema]::Json() }
                    'startapps' { Listar-StartApps }
                    'janelas'   { Listar-Janelas }
                    { $_ -match '^vidro \d+ \d+ \d+ \d+$' } {
                        $n = $_ -split ' '
                        $ok = [Vidro]::Desfoque([long]$n[1], $true) -and [Vidro]::Cantos([long]$n[1], [int]$n[2], [int]$n[3], [int]$n[4])
                        if ($ok) { 'true' } else { 'false' }
                    }
                    { $_ -match '^cantos \d+ \d+ \d+ \d+$' } {
                        $n = $_ -split ' '
                        if ([Vidro]::Cantos([long]$n[1], [int]$n[2], [int]$n[3], [int]$n[4])) { 'true' } else { 'false' }
                    }
                    { $_ -match '^volume-set \d{1,3}$' } { [VolumeSistema]::Definir([int]($_ -split ' ')[1]) }
                    { $_ -match '^mudo-set [01]$' }      { [VolumeSistema]::Mudo(($_ -split ' ')[1] -eq '1') }
                    { $_ -in 'playpause', 'next', 'prev' } { Executar $_ }
                    default     { '{}' }
                }
            } catch {
                $resposta = '{}'
            }
            Escrever ([string]$resposta + "`n")
        }
        exit 0
    }

    if ($Action -eq 'info') { Escrever (Ler-Info $Thumb.IsPresent) } else { Escrever (Executar $Action) }
} catch {
    Escrever '{}'
}

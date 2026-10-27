// helper.cs — o "medidor": programa auxiliar do widget, o mesmo trabalho do media.ps1
// (modo servidor) sem o PowerShell, que sozinho já gasta ~55 MB de RAM.
// Protocolo idêntico: lê um comando por linha na entrada padrão e responde UMA linha
// na saída (JSON, texto ou 'true'/'false'). O main.js compila este arquivo uma vez
// (csc.exe, que vem com o Windows) para %APPDATA%\meu-widget\medidor-<hash>.exe e o
// usa no lugar do PowerShell; se algo falhar, o media.ps1 continua valendo.
//   Comandos: info | info-capa | playpause | next | prev | processos | telacheia
//             | volume | volume-set N | mudo-set 0|1 | vidro HWND L A RAIO | cantos HWND L A RAIO
//             | janelas | iconeapp APPID | iconearq CAMINHO.lnk | gc | sair
//   (a lista de apps do Menu Iniciar, "startapps", é pedida pelo main.js a um PowerShell
//    avulso, só quando a loja de apps abre.)
// ATENÇÃO: as classes ListaProcessos, TelaCheia, VolumeSistema, Vidro e IconeApp são as
// mesmas do media.ps1. Mudou uma, mude a outra.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;


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


public static class IconeApp {
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
    // DIBSECTION = BITMAP + BITMAPINFOHEADER: o cabeçalho diz se as linhas vêm de cima
    // para baixo (biHeight < 0) ou de baixo para cima (biHeight > 0, o padrão dos DIBs)
    [StructLayout(LayoutKind.Sequential)] struct DIBSECTION {
        public int Tipo, L, A, Linha; public short Planos, Bits; public IntPtr Dados;
        public int biSize, biWidth, biHeight; public short biPlanes, biBitCount;
        public int biCompression, biSizeImage, biXPels, biYPels, biClrUsed, biClrImportant;
        public int Campo1, Campo2, Campo3; public IntPtr Secao; public int Deslocamento;
    }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE tamanho, int flags, out IntPtr bitmap); }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string caminho, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int tam, ref DIBSECTION ds);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

    public static string Png(string alvo, int lado) {
        Guid g = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
        IShellItemImageFactory f;
        SHCreateItemFromParsingName(alvo, IntPtr.Zero, ref g, out f);
        IntPtr h;
        if (f.GetImage(new SIZE { cx = lado, cy = lado }, 0, out h) != 0 || h == IntPtr.Zero) return "";
        try {
            DIBSECTION bm = new DIBSECTION();
            if (GetObject(h, Marshal.SizeOf(bm), ref bm) == 0 || bm.Bits != 32 || bm.Dados == IntPtr.Zero) return "";
            using (Bitmap origem = new Bitmap(bm.L, bm.A, bm.Linha, PixelFormat.Format32bppArgb, bm.Dados))
            using (Bitmap copia = new Bitmap(origem))
            using (MemoryStream ms = new MemoryStream()) {
                // linhas de baixo para cima: desvira (senão o ícone fica de cabeça para baixo)
                if (bm.biHeight > 0) copia.RotateFlip(RotateFlipType.RotateNoneFlipY);
                // Ícones da Store vêm com uma placa cinza em volta do logo (o logo fica pequeno).
                // Se o canto é cinza e o que sobra por dentro é colorido, corta a placa e amplia o logo.
                Color canto = copia.GetPixel(2, 2);
                int mx = Math.Max(canto.R, Math.Max(canto.G, canto.B)), mn = Math.Min(canto.R, Math.Min(canto.G, canto.B));
                Bitmap saida = copia;
                if (canto.A > 200 && mx - mn < 24) {
                    int x0 = copia.Width, y0 = copia.Height, x1 = -1, y1 = -1, n = 0;
                    double sat = 0;
                    for (int y = 0; y < copia.Height; y++)
                        for (int x = 0; x < copia.Width; x++) {
                            Color c = copia.GetPixel(x, y);
                            int dif = Math.Max(Math.Abs(c.R - canto.R), Math.Max(Math.Abs(c.G - canto.G), Math.Abs(c.B - canto.B)));
                            if (c.A < 200 || dif > 36) {
                                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                                n++;
                                int cmax = Math.Max(c.R, Math.Max(c.G, c.B)), cmin = Math.Min(c.R, Math.Min(c.G, c.B));
                                sat += cmax == 0 ? 0 : (double)(cmax - cmin) / cmax;
                            }
                        }
                    int l = Math.Max(x1 - x0 + 1, y1 - y0 + 1);
                    if (n > 0 && l >= 24 && sat / n > 0.45) {
                        saida = new Bitmap(96, 96, PixelFormat.Format32bppArgb);
                        using (Graphics gr = Graphics.FromImage(saida)) {
                            gr.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                            gr.DrawImage(copia, new Rectangle(0, 0, 96, 96), (x0 + x1 + 1) / 2 - l / 2, (y0 + y1 + 1) / 2 - l / 2, l, l, GraphicsUnit.Pixel);
                        }
                    }
                }
                saida.Save(ms, ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            }
        } finally { DeleteObject(h); }
    }
}

// ---------- Mídia (SMTC, via WinRT por reflexão: o mesmo caminho do PowerShell) ----------
public static class Midia {
    static Type tGerente, tSessao, tProps, tRef, tStreamCT, tTipoConteudo;
    static object gerente;
    static MethodInfo asTaskGenerico, asStreamForRead;

    static Type Tipo(string nome, string dll) {
        Type t = Type.GetType(nome + ", " + dll + ", ContentType=WindowsRuntime");
        if (t == null) throw new InvalidOperationException("tipo WinRT ausente: " + nome);
        return t;
    }

    // Espera uma operação assíncrona do WinRT (IAsyncOperation<T>) por até 5 s
    static object Aguardar(object operacao, Type tipo) {
        object tarefa = asTaskGenerico.MakeGenericMethod(tipo).Invoke(null, new object[] { operacao });
        if (!((Task)tarefa).Wait(5000)) throw new TimeoutException();
        return tarefa.GetType().GetProperty("Result").GetValue(tarefa, null);
    }

    static void Preparar() {
        if (gerente != null) return;
        foreach (MethodInfo mi in typeof(WindowsRuntimeSystemExtensions).GetMethods()) {
            ParameterInfo[] ps = mi.GetParameters();
            if (mi.Name == "AsTask" && ps.Length == 1 && ps[0].ParameterType.Name == "IAsyncOperation`1") { asTaskGenerico = mi; break; }
        }
        Type tIn = Tipo("Windows.Storage.Streams.IInputStream", "Windows.Storage.Streams");
        asStreamForRead = typeof(WindowsRuntimeStreamExtensions).GetMethod("AsStreamForRead", new Type[] { tIn });
        tGerente = Tipo("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager", "Windows.Media.Control");
        tSessao = Tipo("Windows.Media.Control.GlobalSystemMediaTransportControlsSession", "Windows.Media.Control");
        tProps = Tipo("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties", "Windows.Media.Control");
        tRef = Tipo("Windows.Storage.Streams.IRandomAccessStreamReference", "Windows.Storage.Streams");
        tStreamCT = Tipo("Windows.Storage.Streams.IRandomAccessStreamWithContentType", "Windows.Storage.Streams");
        tTipoConteudo = Tipo("Windows.Storage.Streams.IContentTypeProvider", "Windows.Storage.Streams"); // ContentType vem desta interface-base
        gerente = Aguardar(tGerente.GetMethod("RequestAsync").Invoke(null, null), tGerente);
    }

    static object Sessao() { Preparar(); return tGerente.GetMethod("GetCurrentSession").Invoke(gerente, null); }

    public static string Info(bool comCapa) {
        object sessao = Sessao();
        if (sessao == null) return "{}";
        object props = Aguardar(tSessao.GetMethod("TryGetMediaPropertiesAsync").Invoke(sessao, null), tProps);
        object pb = tSessao.GetMethod("GetPlaybackInfo").Invoke(sessao, null);
        Type tPb = Tipo("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackInfo", "Windows.Media.Control");
        object status = tPb.GetProperty("PlaybackStatus").GetValue(pb, null);
        var sb = new StringBuilder("{");
        sb.Append("\"title\":").Append(Json.Texto(Prop(tProps, props, "Title")));
        sb.Append(",\"artist\":").Append(Json.Texto(Prop(tProps, props, "Artist")));
        sb.Append(",\"album\":").Append(Json.Texto(Prop(tProps, props, "AlbumTitle")));
        sb.Append(",\"status\":").Append(Json.Texto(status == null ? "" : status.ToString()));
        object thumb = tProps.GetProperty("Thumbnail").GetValue(props, null);
        if (comCapa && thumb != null) {
            string capa = CapaDe(thumb);
            if (capa != null) sb.Append(",\"thumb\":").Append(Json.Texto(capa));
        }
        return sb.Append('}').ToString();
    }

    public static string UltimoErro = ""; // para diagnóstico

    // Capa em data URI base64 a partir de um IRandomAccessStreamReference; null se não der
    public static string CapaDe(object thumb) {
        try {
            Preparar();
            object stream = Aguardar(tRef.GetMethod("OpenReadAsync").Invoke(thumb, null), tStreamCT);
            string mime = Prop(tTipoConteudo, stream, "ContentType");
            if (mime.Length == 0) mime = "image/jpeg";
            using (Stream net = (Stream)asStreamForRead.Invoke(null, new object[] { stream }))
            using (var memoria = new MemoryStream()) {
                net.CopyTo(memoria);
                return "data:" + mime + ";base64," + Convert.ToBase64String(memoria.ToArray());
            }
        } catch (Exception e) { UltimoErro = e.ToString(); return null; } // sem capa: segue só com o texto
    }

    static string Prop(Type tipo, object obj, string nome) {
        object v = tipo.GetProperty(nome).GetValue(obj, null);
        return v == null ? "" : v.ToString();
    }

    // playpause | next | prev
    public static string Executar(string acao) {
        object sessao = Sessao();
        if (sessao == null) return "{}";
        string metodo = acao == "playpause" ? "TryTogglePlayPauseAsync" : acao == "next" ? "TrySkipNextAsync" : "TrySkipPreviousAsync";
        Aguardar(tSessao.GetMethod(metodo).Invoke(sessao, null), typeof(bool));
        return "{}";
    }
}

public static class Json {
    // texto entre aspas, com escape (barra, aspas e caracteres de controle)
    public static string Texto(string s) {
        var sb = new StringBuilder("\"");
        foreach (char c in s) {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }
}

// ---------- Programas com janela aberta: [{"n":nome,"p":caminho do .exe}] ----------
public static class Janelas {
    public static string Lista() {
        var vistos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sb = new StringBuilder("[");
        bool primeiro = true;
        foreach (Process p in Process.GetProcesses()) {
            try {
                if (p.MainWindowHandle == IntPtr.Zero || string.IsNullOrEmpty(p.MainWindowTitle)) continue;
                string caminho = null;
                try { caminho = p.MainModule.FileName; } catch { /* sem acesso (processo protegido) */ }
                if (string.IsNullOrEmpty(caminho) || !vistos.Add(caminho)) continue;
                string nome = null;
                try { nome = FileVersionInfo.GetVersionInfo(caminho).FileDescription; } catch { }
                if (string.IsNullOrEmpty(nome)) nome = p.ProcessName;
                if (!primeiro) sb.Append(',');
                primeiro = false;
                sb.Append("{\"n\":").Append(Json.Texto(nome)).Append(",\"p\":").Append(Json.Texto(caminho)).Append('}');
            } catch { /* o processo fechou no meio da leitura */ }
            finally { p.Dispose(); }
        }
        return sb.Append(']').ToString();
    }
}

// ---------- Laço de comandos ----------
public static class Programa {
    static readonly Regex ReIconeApp = new Regex(@"^iconeapp [A-Za-z0-9_.!{}\\ ()-]{1,300}$");
    static readonly Regex ReIconeArq = new Regex(@"^iconearq [A-Za-z]:\\[^""<>|*?\r\n]{1,300}\.lnk$");
    static readonly Regex ReVidro = new Regex(@"^(vidro|cantos) (\d+) (\d+) (\d+) (\d+)$");
    static readonly Regex ReVolume = new Regex(@"^volume-set (\d{1,3})$");

    static string Tratar(string c) {
        switch (c) {
            case "info": return Midia.Info(false);
            case "info-capa": return Midia.Info(true);
            case "playpause": case "next": case "prev": return Midia.Executar(c);
            case "processos": return ListaProcessos.Json();
            case "telacheia": return TelaCheia.Ativa() ? "true" : "false";
            case "volume": return VolumeSistema.Json();
            case "janelas": return Janelas.Lista();
            case "gc": GC.Collect(); return "ok";
            case "mudo-set 0": return VolumeSistema.Mudo(false);
            case "mudo-set 1": return VolumeSistema.Mudo(true);
        }
        Match m;
        if (ReIconeApp.IsMatch(c)) return IconeApp.Png("shell:AppsFolder\\" + c.Substring(9), 96);
        if (ReIconeArq.IsMatch(c)) return IconeApp.Png(c.Substring(9), 96);
        if ((m = ReVidro.Match(c)).Success) {
            long hwnd = long.Parse(m.Groups[2].Value);
            int l = int.Parse(m.Groups[3].Value), a = int.Parse(m.Groups[4].Value), r = int.Parse(m.Groups[5].Value);
            if (m.Groups[1].Value == "cantos") return Vidro.Cantos(hwnd, l, a, r) ? "true" : "false";
            return Vidro.Desfoque(hwnd, true) && Vidro.Cantos(hwnd, l, a, r) ? "true" : "false";
        }
        if ((m = ReVolume.Match(c)).Success) return VolumeSistema.Definir(int.Parse(m.Groups[1].Value));
        return "{}";
    }

    [STAThread]
    static int Main() {
        Stream saida = Console.OpenStandardOutput();
        var entrada = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string linha;
        while ((linha = entrada.ReadLine()) != null) {
            linha = linha.Trim();
            if (linha == "sair") break; // o widget fechou
            string resposta;
            try { resposta = Tratar(linha); } catch { resposta = "{}"; }
            byte[] bytes = new UTF8Encoding(false).GetBytes((resposta ?? "{}") + "\n");
            saida.Write(bytes, 0, bytes.Length);
            saida.Flush();
        }
        return 0;
    }
}

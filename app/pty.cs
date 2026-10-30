// pty.cs — hospeda UM programa (ex.: o Claude Code) num pseudo-console do Windows (ConPTY), para o widget mostrar o terminal
// dele por dentro (xterm.js). Compilado uma vez pelo app/pty.js com o csc.exe que já vem no Windows, só quando você abre a
// primeira sessão; nada roda em segundo plano sem uma sessão aberta.
//
//   pty.exe <colunas> <linhas>      linha de comando e pasta vêm nas variáveis WIDGET_PTY_LINHA e WIDGET_PTY_PASTA
//   stdin  (do widget): quadros  [tipo 1 byte][tamanho 4 bytes LE][dados]
//                         tipo 0 = teclas/colar (bytes que vão ao programa)   tipo 1 = redimensionar (colunas 2 bytes LE, linhas 2 bytes LE)
//   stdout (para o widget): o que o programa desenha, bytes puros (UTF-8 com sequências ANSI)
//   stderr: linhas de controle  "PID <numero>" (o processo do programa)  e  "ERRO <texto>"
//   saída: o código de saída do programa. Se o widget some (stdin fecha), o programa e tudo o que ele abriu é encerrado.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Pty {
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint CREATE_SUSPENDED = 0x00000004;
    static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;

    [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFO {
        public int cb; public IntPtr lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr r, out IntPtr w, IntPtr attrs, uint size);
    [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr pc);
    [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr pc, COORD size);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr pc);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr h, byte[] buf, int n, out int read, IntPtr ov);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr h, byte[] buf, int n, out int written, IntPtr ov);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int classe, IntPtr info, int size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);

    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll")] static extern bool SetStdHandle(int n, IntPtr h);
    // Os canais com o widget (stdout/stderr). Ficam guardados aqui e os padrões do processo são zerados antes de criar o programa:
    // senão ele herdava o stdout deste host e escrevia direto no canal, sem passar pelo pseudo-console.
    static IntPtr canalSaida, canalErro;
    static readonly object trava = new object();
    static void Controle(string t) {
        lock (trava) { byte[] b = Encoding.UTF8.GetBytes(t + "\n"); int n; WriteFile(canalErro, b, b.Length, out n, IntPtr.Zero); }
    }

    static int Main(string[] a) {
        int colunas = 80, linhas = 24;
        try { colunas = int.Parse(a[0]); linhas = int.Parse(a[1]); } catch { }
        canalErro = GetStdHandle(-12);
        canalSaida = GetStdHandle(-11);
        IntPtr canalEntrada = GetStdHandle(-10);
        string linha = Environment.GetEnvironmentVariable("WIDGET_PTY_LINHA");
        string pasta = Environment.GetEnvironmentVariable("WIDGET_PTY_PASTA");
        Environment.SetEnvironmentVariable("WIDGET_PTY_LINHA", null);
        Environment.SetEnvironmentVariable("WIDGET_PTY_PASTA", null);
        if (string.IsNullOrEmpty(linha)) { Controle("ERRO sem linha de comando"); return 2; }
        if (string.IsNullOrEmpty(pasta)) pasta = null;

        IntPtr entradaL, entradaE, saidaL, saidaE, pc;
        if (!CreatePipe(out entradaL, out entradaE, IntPtr.Zero, 0) || !CreatePipe(out saidaL, out saidaE, IntPtr.Zero, 0)) { Controle("ERRO CreatePipe " + Marshal.GetLastWin32Error()); return 3; }
        COORD tam = new COORD { X = (short)colunas, Y = (short)linhas };
        int hr = CreatePseudoConsole(tam, entradaL, saidaE, 0, out pc);
        if (hr != 0) { Controle("ERRO CreatePseudoConsole " + hr + " (precisa do Windows 10 1809 ou mais novo)"); return 4; }
        CloseHandle(entradaL); CloseHandle(saidaE); // o conhost guarda as cópias dele

        IntPtr tamanhoLista = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref tamanhoLista);
        IntPtr lista = Marshal.AllocHGlobal(tamanhoLista);
        if (!InitializeProcThreadAttributeList(lista, 1, 0, ref tamanhoLista)) { Controle("ERRO InitializeProcThreadAttributeList"); return 5; }
        if (!UpdateProcThreadAttribute(lista, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, pc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) { Controle("ERRO UpdateProcThreadAttribute"); return 6; }
        SetStdHandle(-10, IntPtr.Zero); SetStdHandle(-11, IntPtr.Zero); SetStdHandle(-12, IntPtr.Zero); // o programa não herda os canais do widget
        STARTUPINFOEX si = new STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        si.lpAttributeList = lista;
        PROCESS_INFORMATION pi;
        if (!CreateProcessW(null, new StringBuilder(linha), IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED, IntPtr.Zero, pasta, ref si, out pi)) {
            Controle("ERRO CreateProcess " + Marshal.GetLastWin32Error()); return 7;
        }
        // tudo o que o programa abrir morre junto quando este processo acabar (o widget fechou, a sessão foi encerrada...)
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION lim = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        lim.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
        Marshal.StructureToPtr(lim, p, false);
        SetInformationJobObject(job, 9, p, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
        AssignProcessToJobObject(job, pi.hProcess);
        ResumeThread(pi.hThread);
        Controle("PID " + pi.dwProcessId);

        Thread leitura = new Thread(() => {
            byte[] buf = new byte[16384];
            int n;
            while (ReadFile(saidaL, buf, buf.Length, out n, IntPtr.Zero) && n > 0) {
                int w; // numa pipe síncrona o WriteFile só volta depois de gravar tudo
                if (!WriteFile(canalSaida, buf, n, out w, IntPtr.Zero)) return;
            }
        });
        leitura.IsBackground = true;
        leitura.Start();

        Thread teclado = new Thread(() => {
            try {
                // lê o que houver na entrada padrão (ReadFile direto) e separa os quadros: um quadro pode chegar em pedaços ou vários juntos
                IntPtr ent = canalEntrada;
                byte[] lido = new byte[65536];
                byte[] pendente = new byte[1 << 16];
                int n = 0;
                while (true) {
                    int k;
                    if (!ReadFile(ent, lido, lido.Length, out k, IntPtr.Zero) || k <= 0) break;
                    if (n + k > pendente.Length) Array.Resize(ref pendente, Math.Max(pendente.Length * 2, n + k));
                    Buffer.BlockCopy(lido, 0, pendente, n, k);
                    n += k;
                    int pos = 0;
                    while (n - pos >= 5) {
                        int tamanho = BitConverter.ToInt32(pendente, pos + 1);
                        if (tamanho < 0 || tamanho > (1 << 22)) { n = -1; break; }
                        if (n - pos < 5 + tamanho) break; // falta chegar o resto
                        byte tipo = pendente[pos];
                        if (tipo == 0 && tamanho > 0) {
                            byte[] dados = new byte[tamanho];
                            Buffer.BlockCopy(pendente, pos + 5, dados, 0, tamanho);
                            int escrito;
                            WriteFile(entradaE, dados, tamanho, out escrito, IntPtr.Zero);
                        } else if (tipo == 1 && tamanho >= 4) {
                            COORD t2 = new COORD { X = (short)BitConverter.ToUInt16(pendente, pos + 5), Y = (short)BitConverter.ToUInt16(pendente, pos + 7) };
                            if (t2.X > 0 && t2.Y > 0) ResizePseudoConsole(pc, t2);
                        }
                        pos += 5 + tamanho;
                    }
                    if (n < 0) break;
                    if (pos > 0) { Buffer.BlockCopy(pendente, pos, pendente, 0, n - pos); n -= pos; }
                }
            } catch (Exception e) { Controle("ERRO teclado " + e.GetType().Name + " " + e.Message); }
            // o widget fechou o canal: encerra tudo (o job mata os filhos)
            CloseHandle(job);
            Environment.Exit(1);
        });
        teclado.IsBackground = true;
        teclado.Start();

        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint codigo;
        GetExitCodeProcess(pi.hProcess, out codigo);
        // fecha o pseudo-console (pode esperar a saída acabar de sair) e dá um tempo curto para o resto do desenho chegar
        Thread fechar = new Thread(() => ClosePseudoConsole(pc));
        fechar.IsBackground = true;
        fechar.Start();
        leitura.Join(2500);
        return (int)codigo;
    }
}

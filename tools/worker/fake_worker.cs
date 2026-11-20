// test_worker_lifecycle.py signature fixture: compiled at test time as <dir>\resources\sidecar-bin\cattalk-sidecar.exe.
// "spawn-child" starts this same exe with the worker argument (like a multiprocessing spawn child) and keeps running;
// any other invocation just sleeps until it is killed. It never touches Steam or the game.
using System.Diagnostics;
using System.Threading;

static class FakeWorker
{
    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "spawn-child")
        {
            Process self = Process.GetCurrentProcess();
            ProcessStartInfo info = new ProcessStartInfo(self.MainModule.FileName,
                "--multiprocessing-fork parent_pid=" + self.Id + " pipe_handle=0");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            Process.Start(info);
        }
        Thread.Sleep(Timeout.Infinite);
    }
}

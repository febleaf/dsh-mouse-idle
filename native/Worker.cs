using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class MouseWindow : Control
{
    private static readonly int HeaderSize = Marshal.SizeOf(typeof(Win32.RawInputHeader));
    private static readonly int MouseSize = Marshal.SizeOf(typeof(Win32.RawMouse));
    private static readonly int InputSize = Marshal.SizeOf(typeof(Win32.Input));
    private static readonly int[] MouseButtons = { 1, 2, 4, 5, 6 };
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly IdleGate idle = new IdleGate(0);
    private IntPtr buffer;
    private bool monitorValid;

    internal void Start()
    {
        var window = Handle;
        buffer = Marshal.AllocHGlobal(HeaderSize + MouseSize);
        var device = new Win32.RawInputDevice { page = 1, usage = 2, flags = Win32.RIDEV_INPUTSINK | Win32.RIDEV_DEVNOTIFY, window = window };
        if (!Win32.RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf(typeof(Win32.RawInputDevice))))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot register Windows Raw Input mouse monitoring.");
        idle.ObserveMouseActivity(clock.ElapsedMilliseconds);
        monitorValid = true;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
        buffer = IntPtr.Zero;
    }

    protected override void WndProc(ref System.Windows.Forms.Message message)
    {
        if (message.Msg == Win32.WM_INPUT && monitorValid)
        {
            uint bytes = (uint)(HeaderSize + MouseSize);
            uint received = Win32.GetRawInputData(message.LParam, Win32.RID_INPUT, buffer, ref bytes, (uint)HeaderSize);
            if (received == uint.MaxValue || received < HeaderSize + MouseSize)
                monitorValid = false;
            else
            {
                var header = (Win32.RawInputHeader)Marshal.PtrToStructure(buffer, typeof(Win32.RawInputHeader));
                var mouse = (Win32.RawMouse)Marshal.PtrToStructure(IntPtr.Add(buffer, HeaderSize), typeof(Win32.RawMouse));
                if (header.type == Win32.RIM_TYPEMOUSE && (mouse.x != 0 || mouse.y != 0 || mouse.buttonFlags != 0))
                    idle.ObserveMouseActivity(clock.ElapsedMilliseconds);
            }
        }
        else if (message.Msg == Win32.WM_INPUT_DEVICE_CHANGE)
            idle.ObserveMouseActivity(clock.ElapsedMilliseconds);
        base.WndProc(ref message);
    }

    internal object Run(Dictionary<string, object> request)
    {
        string op = TextField(request, "op");
        if (op == "status")
        {
            int idleMs = IdleMilliseconds(request);
            bool available = IsInputDesktop();
            int? remainingMs = available && monitorValid ? (int?)Remaining(idleMs) : null;
            return new { monitoring = monitorValid, desktopAvailable = available, idleMs = idleMs, remainingMs = remainingMs };
        }
        if (!IsInputDesktop())
        {
            idle.ObserveMouseActivity(clock.ElapsedMilliseconds);
            throw new InvalidOperationException("The interactive Windows desktop is unavailable or locked.");
        }
        if (op == "list") return new { windows = ListWindows() };

        var target = ResolveTarget(TextField(request, "window"));
        if (op == "capture") return Capture(target);
        int threshold = IdleMilliseconds(request);
        if (op == "activate")
        {
            int pause = Remaining(threshold);
            if (pause > 0) return new { remainingMs = pause };
            if (Win32.GetForegroundWindow() != target && !Win32.SetForegroundWindow(target))
                throw new InvalidOperationException("Windows refused to focus the target window. Bring it to the foreground manually and retry.");
            if (Win32.GetForegroundWindow() != target)
                throw new InvalidOperationException("Windows did not confirm foreground focus on the target window.");
            return new { ok = true };
        }

        int remaining = Remaining(threshold);
        if (remaining > 0) return new { remainingMs = remaining };
        if (!Win32.IsWindowEnabled(target) || Win32.GetForegroundWindow() != target)
            throw new InvalidOperationException("The target must be the active, enabled foreground window. Activate it first and inspect its current state.");
        var events = BuildMouseEvents(op, target, request);
        remaining = Remaining(threshold);
        if (remaining > 0) return new { remainingMs = remaining };
        if (Win32.GetForegroundWindow() != target)
            throw new InvalidOperationException("The foreground window changed before the mouse action.");
        uint sent = Win32.SendInput((uint)events.Length, events, InputSize);
        if (sent != events.Length)
        {
            if (sent > 0 && (op == "drag" || op == "click"))
            {
                var release = events[events.Length - 1];
                Win32.SendInput(1, new[] { release }, InputSize);
            }
            throw new InvalidOperationException("Windows did not deliver the whole mouse action. Inspect the window before retrying.");
        }
        return new { ok = true };
    }

    private int Remaining(int threshold)
    {
        // Sent messages can be handled before queued raw input. Drain the
        // monitor's own input messages before making the dispatch decision.
        Win32.Message pending;
        int drained = 0;
        while (Win32.PeekMessage(out pending, Handle, Win32.WM_INPUT_DEVICE_CHANGE, Win32.WM_INPUT, 1))
        {
            Win32.DispatchMessage(ref pending);
            if (++drained == 4096) return threshold;
        }
        if (!monitorValid) throw new InvalidOperationException("Windows mouse activity could not be verified. Re-enable the plugin to restart monitoring.");
        if (!IsInputDesktop())
        {
            idle.ObserveMouseActivity(clock.ElapsedMilliseconds);
            throw new InvalidOperationException("The mouse monitor's Windows desktop is no longer active.");
        }
        bool held = Array.Exists(MouseButtons, key => Win32.GetAsyncKeyState(key) < 0);
        return idle.Remaining(clock.ElapsedMilliseconds, threshold, held);
    }

    private static int IdleMilliseconds(Dictionary<string, object> request)
    {
        int n = IntField(request, "idleMs");
        if (n < 1 || n > 2147483000) throw new ArgumentOutOfRangeException("idleMs");
        return n;
    }

    private static string DesktopName(IntPtr handle)
    {
        var name = new StringBuilder(256);
        uint needed;
        return handle != IntPtr.Zero && Win32.GetUserObjectInformation(handle, 2, name, 512, out needed) ? name.ToString() : null;
    }

    private static bool IsInputDesktop()
    {
        var input = Win32.OpenInputDesktop(0, false, 1);
        if (input == IntPtr.Zero) return false;
        try
        {
            string name = DesktopName(input);
            return name != null && name == DesktopName(Win32.GetThreadDesktop(Win32.GetCurrentThreadId()));
        }
        finally { Win32.CloseDesktop(input); }
    }

    private static List<object> ListWindows()
    {
        var result = new List<object>();
        var active = Win32.GetForegroundWindow();
        Win32.EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            if (!Win32.IsWindowVisible(window)) return true;
            var title = new StringBuilder(513);
            if (Win32.GetWindowText(window, title, title.Capacity) < 1) return true;
            uint pid;
            Win32.GetWindowThreadProcessId(window, out pid);
            result.Add(new { window = window.ToInt64().ToString(CultureInfo.InvariantCulture) + ":" + pid.ToString(CultureInfo.InvariantCulture), title = title.ToString(), foreground = window == active, minimized = Win32.IsIconic(window) });
            return result.Count < 100;
        }, IntPtr.Zero);
        return result;
    }

    private static IntPtr ResolveTarget(string id)
    {
        var pieces = id.Split(':');
        long handle;
        uint expected, actual;
        if (pieces.Length != 2 || !long.TryParse(pieces[0], NumberStyles.None, CultureInfo.InvariantCulture, out handle)
            || handle == 0 || !uint.TryParse(pieces[1], out expected))
            throw new ArgumentException("The target window ID is invalid. List Windows windows again.");
        var window = new IntPtr(handle);
        if (!Win32.IsWindow(window) || Win32.GetAncestor(window, Win32.GA_ROOT) != window || !Win32.IsWindowVisible(window)
            || Win32.GetWindowThreadProcessId(window, out actual) == 0 || expected != actual)
            throw new InvalidOperationException("The target window is no longer available. List Windows windows again.");
        if (Win32.IsIconic(window)) throw new InvalidOperationException("The target window is minimized. Restore it before continuing.");
        return window;
    }

    private static Win32.Rect WindowRect(IntPtr window)
    {
        Win32.Rect rect;
        if (!Win32.GetWindowRect(window, out rect) || rect.right <= rect.left || rect.bottom <= rect.top)
            throw new InvalidOperationException("The target window bounds are unavailable.");
        return rect;
    }

    private static object Capture(IntPtr window)
    {
        var bounds = WindowRect(window);
        int width = bounds.right - bounds.left;
        int height = bounds.bottom - bounds.top;
        if ((long)width * height > 16000000) throw new InvalidOperationException("The window is too large to capture.");
        using (var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb))
        using (var graphics = Graphics.FromImage(bitmap))
        using (var stream = new MemoryStream())
        {
            var dc = graphics.GetHdc();
            try
            {
                if (!Win32.PrintWindow(window, dc, 2)) throw new InvalidOperationException("Windows could not capture this window.");
            }
            finally { graphics.ReleaseHdc(dc); }
            bitmap.Save(stream, ImageFormat.Png);
            return new { width = width, height = height, data = Convert.ToBase64String(stream.ToArray()) };
        }
    }

    private static Win32.Input[] BuildMouseEvents(string op, IntPtr window, Dictionary<string, object> request)
    {
        var rect = WindowRect(window);
        int x = IntField(request, "x"), y = IntField(request, "y");
        var start = MoveTo(window, rect, x, y);
        if (op == "click")
        {
            object value;
            string button = request.TryGetValue("button", out value) ? value as string : "left";
            switch (button)
            {
                case "left": return new[] { start, Mouse(Win32.LeftDown), Mouse(Win32.LeftUp) };
                case "right": return new[] { start, Mouse(Win32.RightDown), Mouse(Win32.RightUp) };
                case "middle": return new[] { start, Mouse(Win32.MiddleDown), Mouse(Win32.MiddleUp) };
                default: throw new ArgumentException("Choose left, right, or middle mouse button.");
            }
        }
        if (op == "scroll")
        {
            int notches = IntField(request, "notches");
            if (notches == 0 || notches < -12 || notches > 12) throw new ArgumentOutOfRangeException("notches");
            return new[] { start, Mouse(Win32.Wheel, unchecked((uint)(notches * 120))) };
        }
        if (op == "drag")
        {
            int endX = IntField(request, "toX"), endY = IntField(request, "toY");
            var end = MoveTo(window, rect, endX, endY);
            var events = new List<Win32.Input> { start, Mouse(Win32.LeftDown) };
            for (int i = 1; i < 8; i++) events.Add(MoveTo(window, rect, x + (endX - x) * i / 8, y + (endY - y) * i / 8));
            events.Add(end);
            events.Add(Mouse(Win32.LeftUp));
            return events.ToArray();
        }
        throw new ArgumentException("Unknown Windows input action.");
    }

    private static Win32.Input MoveTo(IntPtr window, Win32.Rect rect, int x, int y)
    {
        if (x < 0 || y < 0 || x >= rect.right - rect.left || y >= rect.bottom - rect.top)
            throw new ArgumentOutOfRangeException("x/y", "Coordinates must be inside the target window.");
        var point = new Win32.Point(rect.left + x, rect.top + y);
        int vx = Win32.GetSystemMetrics(76), vy = Win32.GetSystemMetrics(77);
        int width = Win32.GetSystemMetrics(78), height = Win32.GetSystemMetrics(79);
        if (width <= 0 || height <= 0 || point.x < vx || point.x >= vx + width || point.y < vy || point.y >= vy + height
            || Win32.GetAncestor(Win32.WindowFromPoint(point), Win32.GA_ROOT) != window)
            throw new InvalidOperationException("A mouse point is covered by another window or outside the desktop.");
        // SendInput absolute units map to the full virtual desktop. Choose the
        // first normalized coordinate mapping to the requested physical pixel.
        int dx = (int)Math.Min(65535, ((long)(point.x - vx) * 65536 + width - 1) / width);
        int dy = (int)Math.Min(65535, ((long)(point.y - vy) * 65536 + height - 1) / height);
        return Mouse(Win32.Move | Win32.Absolute | Win32.VirtualDesk | Win32.MoveNoCoalesce, 0, dx, dy);
    }

    private static Win32.Input Mouse(uint flags, uint data = 0, int x = 0, int y = 0)
    {
        return new Win32.Input { mouse = new Win32.MouseInput { x = x, y = y, data = data, flags = flags } };
    }

    private static string TextField(Dictionary<string, object> request, string key)
    {
        object field;
        if (!request.TryGetValue(key, out field) || !(field is string)) throw new ArgumentException("Expected text for " + key);
        return (string)field;
    }

    private static int IntField(Dictionary<string, object> request, string key)
    {
        object field;
        if (!request.TryGetValue(key, out field) || !(field is int)) throw new ArgumentException("Expected an integer for " + key);
        return (int)field;
    }
}

internal static class Worker
{
    [STAThread]
    public static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (!Win32.SetProcessDpiAwarenessContext(new IntPtr(-4)))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Per-monitor DPI coordinates could not be initialized.");
            using (var window = new MouseWindow())
            {
                window.Start();
                var reader = new Thread(() => ReadRequests(window)) { IsBackground = true };
                reader.Start();
                Application.Run();
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            Environment.ExitCode = 1;
        }
    }

    private static void ReadRequests(MouseWindow window)
    {
        var json = new JavaScriptSerializer { MaxJsonLength = 33554432 };
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            int id = 0;
            try
            {
                var request = json.Deserialize<Dictionary<string, object>>(line);
                id = (int)request["id"];
                var result = window.Invoke(new Func<object>(() => window.Run(request)));
                Console.WriteLine(json.Serialize(new { id = id, result = result }));
            }
            catch (Exception error)
            {
                Console.WriteLine(json.Serialize(new { id = id, error = error.GetBaseException().Message }));
            }
        }
        window.BeginInvoke(new Action(Application.ExitThread));
    }
}

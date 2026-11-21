using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class Win32
{
    internal const int WM_INPUT = 0x00FF;
    internal const int WM_INPUT_DEVICE_CHANGE = 0x00FE;
    internal const uint RIDEV_INPUTSINK = 0x00000100;
    internal const uint RIDEV_DEVNOTIFY = 0x00002000;
    internal const uint RID_INPUT = 0x10000003;
    internal const uint RIM_TYPEMOUSE = 0;
    internal const uint GA_ROOT = 2;
    internal const uint Move = 0x0001;
    internal const uint LeftDown = 0x0002;
    internal const uint LeftUp = 0x0004;
    internal const uint RightDown = 0x0008;
    internal const uint RightUp = 0x0010;
    internal const uint MiddleDown = 0x0020;
    internal const uint MiddleUp = 0x0040;
    internal const uint Wheel = 0x0800;
    internal const uint MoveNoCoalesce = 0x2000;
    internal const uint VirtualDesk = 0x4000;
    internal const uint Absolute = 0x8000;

    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputDevice { internal ushort page, usage; internal uint flags; internal IntPtr window; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct RawInputHeader { internal uint type, size; internal IntPtr device, parameters; }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    internal struct RawMouse
    {
        [FieldOffset(4)] internal ushort buttonFlags;
        [FieldOffset(12)] internal int x;
        [FieldOffset(16)] internal int y;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Point { internal int x, y; internal Point(int x, int y) { this.x = x; this.y = y; } }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect { internal int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Message
    {
        internal IntPtr hwnd;
        internal uint message;
        internal UIntPtr wParam;
        internal IntPtr lParam;
        internal uint time;
        internal Point point;
        internal uint reserved;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct MouseInput { internal int x, y; internal uint data, flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Input { internal uint type; internal MouseInput mouse; }

    internal delegate bool WindowVisitor(IntPtr hwnd, IntPtr payload);

    [DllImport("user32.dll", SetLastError = true)] internal static extern bool RegisterRawInputDevices(RawInputDevice[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)] internal static extern uint GetRawInputData(IntPtr input, uint command, IntPtr bytes, ref uint size, uint headerSize);
    [DllImport("user32.dll")] internal static extern bool PeekMessage(out Message message, IntPtr hwnd, uint min, uint max, uint flags);
    [DllImport("user32.dll")] internal static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] internal static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] internal static extern bool CloseDesktop(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint capacity, out uint needed);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(WindowVisitor visitor, IntPtr payload);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(IntPtr hwnd, StringBuilder title, int size);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool PrintWindow(IntPtr hwnd, IntPtr destination, uint flags);
    [DllImport("user32.dll")] internal static extern bool GetCursorPos(out Point point);
}

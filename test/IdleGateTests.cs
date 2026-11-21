using System;

internal static class IdleGateTests
{
    private static void Equal(int expected, int actual, string name)
    {
        if (expected != actual) throw new Exception(name + ": expected " + expected + ", got " + actual);
    }

    public static int Main()
    {
        var gate = new IdleGate(1000);
        Equal(1, gate.Remaining(3999, 3000, false), "initial continuous idle");
        Equal(0, gate.Remaining(4000, 3000, false), "exact default threshold");
        gate.ObserveMouseActivity(6800);
        Equal(2999, gate.Remaining(6801, 3000, false), "movement resets the full interval");
        Equal(1, gate.Remaining(9799, 3000, false), "old idle deadline cannot admit action");
        Equal(0, gate.Remaining(9800, 3000, false), "admit after new continuous interval");
        gate.ObserveMouseActivity(10000);
        Equal(250, gate.Remaining(10500, 750, false), "configured interval in milliseconds");
        Equal(0, gate.Remaining(10750, 750, false), "configured threshold");
        if (gate.Remaining(12500, 750, true) <= 0) throw new Exception("held mouse button admitted an action");
        gate.ObserveMouseActivity(12600);
        Equal(750, gate.Remaining(12600, 750, false), "button release starts a new interval");
        Equal(0, gate.Remaining(13350, 750, false), "admit after release and idle");
        Console.WriteLine("Native idle gate passed 10 assertions.");
        return 0;
    }
}

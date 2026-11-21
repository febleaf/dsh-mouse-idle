using System;

internal sealed class IdleGate
{
    private long lastActivity;

    internal IdleGate(long now) { lastActivity = now; }

    internal void ObserveMouseActivity(long now) { lastActivity = now; }

    internal int Remaining(long now, int idleMilliseconds, bool buttonHeld)
    {
        if (buttonHeld)
        {
            ObserveMouseActivity(now);
            return idleMilliseconds;
        }
        return (int)Math.Max(0, idleMilliseconds - (now - lastActivity));
    }
}

using System;
using System.Drawing;
using System.Windows.Forms;

internal static class WindowsFixture
{
    [STAThread]
    public static void Main(string[] args)
    {
        using (var form = new Form())
        using (var timeout = new Timer())
        {
            form.Text = args[0];
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new Size(340, 220);
            form.TopMost = true;
            form.Shown += (sender, e) => { form.Activate(); Console.WriteLine("READY"); };
            form.MouseClick += (sender, e) => Console.WriteLine("CLICK " + e.Button);
            timeout.Interval = 45000;
            timeout.Tick += (sender, e) => form.Close();
            timeout.Start();
            Application.Run(form);
        }
    }
}

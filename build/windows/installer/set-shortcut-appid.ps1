param(
    [Parameter(Mandatory = $true)]
    [string]$ShortcutPath,

    [Parameter(Mandatory = $true)]
    [string]$AppUserModelId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    throw "Shortcut not found: $ShortcutPath"
}

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
public class ShellLink
{
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
public interface IPersistFile
{
    void GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
public interface IPropertyStore
{
    uint GetCount(out uint propertyCount);
    uint GetAt(uint propertyIndex, out PROPERTYKEY key);
    uint GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
    uint SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
    uint Commit();
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY
{
    public Guid fmtid;
    public uint pid;

    public PROPERTYKEY(Guid formatId, uint propertyId)
    {
        fmtid = formatId;
        pid = propertyId;
    }
}

[StructLayout(LayoutKind.Sequential)]
public struct PROPVARIANT
{
    public ushort vt;
    public ushort wReserved1;
    public ushort wReserved2;
    public ushort wReserved3;
    public IntPtr pointerValue;
    public int int32Value;
}

public static class NativeMethods
{
    [DllImport("propsys.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void InitPropVariantFromString(string value, out PROPVARIANT propertyValue);

    [DllImport("ole32.dll", PreserveSig = false)]
    public static extern void PropVariantClear(ref PROPVARIANT propertyValue);
}

public static class ShortcutAppIdSetter
{
    public static void SetAppId(string shortcutPath, string appUserModelId)
    {
        var shellLink = new ShellLink();
        var persistFile = (IPersistFile)shellLink;
        persistFile.Load(shortcutPath, 0);

        var propertyStore = (IPropertyStore)shellLink;
        var appUserModelIdKey = new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
        PROPVARIANT propertyValue;
        NativeMethods.InitPropVariantFromString(appUserModelId, out propertyValue);
        try
        {
            Marshal.ThrowExceptionForHR((int)propertyStore.SetValue(ref appUserModelIdKey, ref propertyValue));
            Marshal.ThrowExceptionForHR((int)propertyStore.Commit());
        }
        finally
        {
            NativeMethods.PropVariantClear(ref propertyValue);
        }

        persistFile.Save(shortcutPath, true);
    }
}
"@

[ShortcutAppIdSetter]::SetAppId($ShortcutPath, $AppUserModelId)
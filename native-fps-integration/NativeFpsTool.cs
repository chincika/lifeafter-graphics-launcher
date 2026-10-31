using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;


internal sealed class NativeFpsSlot
{
    internal int Archive, Length;
    internal long Offset;
    internal string Name, OldHash, NewHash, PrototypeHash;
    internal byte[] Old, New;
}
internal sealed class NativeFpsConfigEdit
{
    internal FileStream Stream;
    internal byte[] Before, After;
    internal string Backup;
}

internal sealed partial class NativeFpsTool
{
    private const string Py3Hash="61D356DF5F7725D064AAD9029DF3A41B2CB9F654D22B1B641D1A944205A83EAB";
    private const string LcHash="C1145C125862D29A7023962AE61D3981DCEA7E2A6BD2915EEDB6A6ED71853B72";
    private static readonly string[] FileNames={"script.py3.npk","script.py314.lc.npk"};
    private static readonly string[] Expected={Py3Hash,LcHash};
    private static readonly long[] Lengths={453847908,293961100};
    internal static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=8*1024*1024};
    
    private readonly NativeFpsSlot[] slots={
        new NativeFpsSlot {Name="panel",Archive=1,Offset=239435364,Length=162653,
            OldHash="697F3CB40B9376B0FD782A5E97A9E79C9AA9D981082F60A68DF6636132086D3A",NewHash="5C24A38CBE9C3F6F1EC2F4F14546347321AE3E212E57D41E54CB9336CB963107",PrototypeHash="F4DE5E7747E70E1DB640933D5BA71EBB99C055FDB2E400B6D67CFA9B059F60E2"},
        new NativeFpsSlot {Name="manager",Archive=1,Offset=237231880,Length=108926,
            OldHash="A4063BB5141C2F88B40CA54AE39CE68F55F75E25CF3B55B9387FD91BF77D3055",NewHash="9C5855118D875EA3785EDD6D8461D94B7ECA06347B7615460319CB5B5C38441B",PrototypeHash="FC953B5733F582011C358967DA2F841C0A5D7E38133E9B413BC11237FCBE8C1B"}
    };

    internal NativeFpsTool()
    {
        foreach(NativeFpsSlot s in slots)
        {
            s.Old=Resource(s.Name+".original.bin"); s.New=Resource(s.Name+".v04.bin");
            if(s.Old.Length!=s.Length || s.New.Length!=s.Length || Hash(s.Old)!=s.OldHash || Hash(s.New)!=s.NewHash)
                throw new InvalidDataException("内置资源校验失败："+s.Name);
        }
    }
    private static byte[] Resource(string name)
    {
        using(Stream s=Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if(s==null) throw new InvalidDataException("缺少资源："+name);
            using(MemoryStream m=new MemoryStream()) {s.CopyTo(m); return m.ToArray();}
        }
    }
    private static string Hash(byte[] b)
    { using(SHA256 h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(b)).Replace("-",""); }
    private static string FileHash(string path)
    { using(FileStream f=File.OpenRead(path)) using(SHA256 h=SHA256.Create()) return BitConverter.ToString(h.ComputeHash(f)).Replace("-",""); }
    private static byte[] ReadAt(FileStream f,long offset,int length)
    {
        byte[] b=new byte[length]; f.Position=offset; int p=0;
        while(p<length) {int n=f.Read(b,p,length-p); if(n==0) throw new EndOfStreamException(); p+=n;}
        return b;
    }
    private static void WriteAt(FileStream f,long offset,byte[] b) { f.Position=offset; f.Write(b,0,b.Length); }
    private static void HashRange(FileStream f,SHA256 h,long offset,long length)
    {
        byte[] b=new byte[1024*1024]; f.Position=offset;
        while(length>0) {int n=f.Read(b,0,(int)Math.Min(b.Length,length)); if(n==0) throw new EndOfStreamException(); h.TransformBlock(b,0,n,null,0); length-=n;}
    }
    // mode 0 reads current bytes, 1 normalizes the reviewed slots to stock,
    // and 2 calculates the expected fully installed archive.
    private string ArchiveHash(FileStream f,int archive,int mode)
    {
        using(SHA256 h=SHA256.Create())
        {
            long pos=0;
            foreach(NativeFpsSlot s in slots.Where(x=>x.Archive==archive).OrderBy(x=>x.Offset))
            {
                if(s.Offset<pos || s.Offset+s.Length>f.Length) throw new InvalidDataException("包体记录边界异常。");
                HashRange(f,h,pos,s.Offset-pos);
                if(mode==0) HashRange(f,h,s.Offset,s.Length);
                else {byte[] b=mode==1?s.Old:s.New; h.TransformBlock(b,0,b.Length,null,0);}
                pos=s.Offset+s.Length;
            }
            HashRange(f,h,pos,f.Length-pos); h.TransformFinalBlock(new byte[0],0,0);
            return BitConverter.ToString(h.Hash).Replace("-","");
        }
    }
    internal static string Resolve(string input)
    {
        string root=Path.GetFullPath(input.Trim().Trim('"'));
        if(File.Exists(root)) root=Path.GetDirectoryName(root);
        if(Path.GetFileName(root).Equals("Documents",StringComparison.OrdinalIgnoreCase)) root=Path.GetDirectoryName(root);
        string doc=Path.Combine(root,"Documents");
        foreach(string name in FileNames) if(!File.Exists(Path.Combine(doc,name))) throw new FileNotFoundException("没有找到当前版本所需的游戏包体。",Path.Combine(doc,name));
        return root;
    }
    private static void EnsureStopped()
    {
        if(IsGameRunning()) throw new InvalidOperationException("请先完全退出游戏和官方启动器，再进行安装或恢复。");
    }
    private static bool IsGameRunning()
    {
        string[] names={"lifeafter","mingrizhihou","mrzh_launcher","FeverGamesLauncher"};
        foreach(Process p in Process.GetProcesses()) using(p)
            if(names.Contains(p.ProcessName,StringComparer.OrdinalIgnoreCase))
                return true;
        return false;
    }
    private string BackupDirectory(string root)
    { return Path.Combine(root,"帧率解锁备份","游戏内档位"); }
    private static FileStream[] Open(string root, bool write)
    {
        FileStream[] f=new FileStream[2];
        try
        {
            for(int i=0;i<2;i++) f[i]=new FileStream(Path.Combine(root,"Documents",FileNames[i]),FileMode.Open,
                write?FileAccess.ReadWrite:FileAccess.Read,write?FileShare.None:FileShare.Read);
            return f;
        }
        catch {foreach(FileStream x in f) if(x!=null) x.Dispose(); throw;}
    }
    private static void Close(FileStream[] f) {foreach(FileStream x in f) if(x!=null) x.Dispose();}
    private string Inspect(FileStream[] f)
    {
        for(int i=0;i<2;i++)
            if(f[i].Length!=Lengths[i] || ArchiveHash(f[i],i,1)!=Expected[i])
                throw new InvalidDataException("游戏包版本不匹配，或目标记录以外的内容已变化；拒绝操作。请关闭其他帧率补丁后重新检测。");
        bool allOld=true,allNew=true,allPrototype=true;
        foreach(NativeFpsSlot s in slots)
        {
            string hash=Hash(ReadAt(f[s.Archive],s.Offset,s.Length));
            if(hash!=s.OldHash && hash!=s.NewHash && hash!=s.PrototypeHash)
                throw new InvalidDataException("检测到其他帧率补丁或未知记录，请先使用对应工具恢复原始包体。");
            allOld &= hash==s.OldHash; allNew &= hash==s.NewHash; allPrototype &= hash==s.PrototypeHash;
        }
        return allOld?"official":allNew?"native":allPrototype?"prototype":"partial";
    }
    private Dictionary<string,object> Result(string root,string state,string message,string backup)
    {
        bool pending=AdaptiveHasNewerPart(root);
        return new Dictionary<string,object> {{"ok",true},{"version","0.4.0"},{"root",root},{"state",state},
            {"message",message+(pending?" 检测到比当前包体更新的未完成更新文件，请先核实并退出更新器。":"")},
            {"gameRunning",IsGameRunning()},{"updatePending",pending},{"backupDirectory",BackupDirectory(root)},{"backup",backup}};
    }
    internal Dictionary<string,object> Status(string input)
    {
        string root=Resolve(input); FileStream[] f=Open(root,false);
        try
        {
            try {string state=Inspect(f); if(state=="prototype" || state=="partial") return Result(root,state,state=="prototype"?"已安装 240 帧实验版，可直接升级。":"检测到部分修改，可使用恢复功能。",null);}
            catch(InvalidDataException) { }
        }
        finally {Close(f);}
        return AdaptiveStatus(root);
    }
    private bool FixedCompatible(string root)
    {
        FileStream[] f=Open(root,false);
        try { try { string state=Inspect(f); return state=="prototype" || state=="partial"; } catch(InvalidDataException) {return false;} }
        finally {Close(f);}
    }
    private static void Backup(FileStream f,string path,string expected)
    {
        using(FileStream b=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None))
        {f.Position=0; f.CopyTo(b); b.Flush(true);}
        if(FileHash(path)!=expected) throw new IOException("完整备份校验失败，未写入游戏文件。");
    }
    // A v0.3 upgrade backs up both the exact pre-upgrade archive and a full,
    // independently verified stock archive reconstructed from reviewed slots.
    private void BackupStock(FileStream source,int archive,string path)
    {
        using(FileStream b=new FileStream(path,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None))
        {
            source.Position=0; source.CopyTo(b);
            foreach(NativeFpsSlot slot in slots.Where(x=>x.Archive==archive)) WriteAt(b,slot.Offset,slot.Old);
            b.Flush(true);
        }
        if(FileHash(path)!=Expected[archive]) throw new IOException("原始包体备份校验失败，未写入游戏文件。");
    }
    internal bool HasNativeSlots(string input)
    {
        try
        {
            string root=Resolve(input);
            using(FileStream f=new FileStream(Path.Combine(root,"Documents",FileNames[1]),FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
            {
                if(f.Length==Lengths[1] && slots.Any(s=>{string h=Hash(ReadAt(f,s.Offset,s.Length));return h==s.NewHash || h==s.PrototypeHash;})) return true;
            }
            return AdaptiveHasNativeSlots(root);
        }
        catch(FileNotFoundException) {return false;}
        catch(DirectoryNotFoundException) {return false;}
    }
    private static void SaveJournal(string path,Dictionary<string,object> j)
    {
        string tmp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        using(FileStream f=new FileStream(tmp,FileMode.CreateNew,FileAccess.Write,FileShare.None))
        {byte[] b=new UTF8Encoding(false).GetBytes(Json.Serialize(j));f.Write(b,0,b.Length);f.Flush(true);}
        if(File.Exists(path)) File.Replace(tmp,path,null); else File.Move(tmp,path);
    }
    private static string[] ConfigHashes(string root)
    {return new[]{"pcconfig","qualityconfig","optconfig"}.Select(x=>Path.Combine(root,"Documents","configs",x)).Select(x=>File.Exists(x)?FileHash(x):"absent").ToArray();}
    private static bool Same(string[] a,string[] b) {return a.SequenceEqual(b,StringComparer.Ordinal);}
    internal Dictionary<string,object> Apply(string input,bool agreed)
    {
        if(!agreed) throw new InvalidOperationException("请先阅读并勾选实验版风险说明。");
        string root=Resolve(input); EnsureStopped();
        if(!FixedCompatible(root)) return AdaptiveApply(root);
        using(Mutex mutex=new Mutex(false,"Local\\Native240OptionV03-"+Hash(Encoding.UTF8.GetBytes(root.ToUpperInvariant())).Substring(0,20)))
        {
            if(!mutex.WaitOne(0)) throw new IOException("另一个工具正在操作此包体。");
            try
            {
                FileStream[] f=Open(root,true);
                try
                {
                    string state=Inspect(f); if(state=="native") return Result(root,state,"游戏内四档已经安装。",null);
                    if(state!="official" && state!="prototype") throw new InvalidDataException("包体处于部分修改状态，请先使用恢复功能。");
                    string[] configs=ConfigHashes(root);
                    byte[][] before=slots.Select(s=>ReadAt(f[s.Archive],s.Offset,s.Length)).ToArray();
                    string[] beforeHashes=Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,0)).ToArray();
                    string[] target=Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,2)).ToArray();
                    string dir=Path.Combine(BackupDirectory(root),DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8));
                    Directory.CreateDirectory(dir);
                    long required=Lengths.Sum()+(state=="prototype"?Lengths[1]:0)+64L*1024*1024;
                    if(new DriveInfo(Path.GetPathRoot(dir)).AvailableFreeSpace<required)
                        throw new IOException("游戏目录所在磁盘空间不足，无法建立完整备份。");
                    for(int i=0;i<2;i++) Backup(f[i],Path.Combine(dir,FileNames[i]+".before"),beforeHashes[i]);
                    if(state=="prototype") BackupStock(f[1],1,Path.Combine(dir,FileNames[1]+".original"));
                    string journalPath=Path.Combine(dir,"journal.json");
                    Dictionary<string,object> journal=new Dictionary<string,object>{{"version","0.4.0"},{"root",root},{"state","prepared"},
                        {"before",beforeHashes},{"after",target},{"createdUtc",DateTime.UtcNow.ToString("O")}};
                    SaveJournal(journalPath,journal); EnsureStopped(); AdaptiveCheckNoNewerPart(root);
                    try
                    {
                        foreach(NativeFpsSlot s in slots) WriteAt(f[s.Archive],s.Offset,s.New);
                        foreach(FileStream stream in f) stream.Flush(true);
                        if(Inspect(f)!="native" || !Same(Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,0)).ToArray(),target))
                            throw new IOException("安装后整包校验失败。");
                        if(!Same(configs,ConfigHashes(root))) throw new IOException("操作期间游戏配置发生变化。");
                        journal["state"]="installed"; SaveJournal(journalPath,journal);
                        return Result(root,"native","安装完成。请在游戏显示设置中选择 180 / 240 / 300 / 360 帧。",dir);
                    }
                    catch
                    {
                        for(int i=0;i<slots.Length;i++) WriteAt(f[slots[i].Archive],slots[i].Offset,before[i]);
                        foreach(FileStream stream in f) stream.Flush(true);
                        if(!Same(Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,0)).ToArray(),beforeHashes))
                            throw new IOException("回滚校验失败，请勿启动游戏；完整备份："+dir);
                        journal["state"]="rolled-back";SaveJournal(journalPath,journal);throw;
                    }
                }
                finally {Close(f);}
            }
            finally {mutex.ReleaseMutex();}
        }
    }
    private static int ParseNativeQuality(byte[] before,out string text,out int bom,out int start,out int end)
    {
        bom=before.Length>=3 && before[0]==239 && before[1]==187 && before[2]==191?3:0;
        text=new UTF8Encoding(false,true).GetString(before,bom,before.Length-bom);
        Dictionary<string,object> data=Json.Deserialize<Dictionary<string,object>>(text); object frame;
        if(data==null || !data.TryGetValue("frame",out frame) || !(frame is int) || (int)frame<0 || (int)frame>10)
            throw new InvalidDataException("无法确认保存的帧率索引，未修改游戏文件。");
        int depth=0,matches=0; start=-1; end=-1;
        for(int n=0;n<text.Length;n++)
        {
            char c=text[n]; if(c=='{' || c=='[') depth++; else if(c=='}' || c==']') depth--;
            else if(c=='"')
            {
                int begin=n++;bool escaped=false;
                for(;n<text.Length;n++) {if(escaped){escaped=false;continue;} if(text[n]=='\\'){escaped=true;continue;} if(text[n]=='"')break;}
                if(n>=text.Length) throw new InvalidDataException("qualityconfig 字符串异常。");
                if(depth==1 && Json.Deserialize<string>(text.Substring(begin,n-begin+1))=="frame")
                {
                    int k=n+1;while(k<text.Length && Char.IsWhiteSpace(text[k]))k++;
                    if(k<text.Length && text[k]==':') {k++;while(k<text.Length && Char.IsWhiteSpace(text[k]))k++;start=k;
                        while(k<text.Length && !Char.IsWhiteSpace(text[k]) && text[k]!=',' && text[k]!='}')k++;end=k;matches++;}
                }
            }
        }
        if(matches!=1 || text.Substring(start,end-start)!=((int)frame).ToString())
            throw new InvalidDataException("无法唯一定位保存的帧率配置，未修改游戏文件。");
        return (int)frame;
    }
    private NativeFpsConfigEdit PrepareConfig(string root,string directory)
    {
        string path=Path.Combine(root,"Documents","configs","qualityconfig");
        if(!File.Exists(path)) return null;
        FileStream f=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None);
        try
        {
            if(f.Length>8*1024*1024) throw new InvalidDataException("qualityconfig 尺寸异常。");
            byte[] before=ReadAt(f,0,(int)f.Length); string text; int bom,start,end;
            int frame=ParseNativeQuality(before,out text,out bom,out start,out end);
            if(frame<7) {f.Dispose();return null;}
            byte[] encoded=new UTF8Encoding(false).GetBytes(text.Substring(0,start)+"4"+text.Substring(end)),after=new byte[bom+encoded.Length];
            if(bom!=0)Buffer.BlockCopy(before,0,after,0,bom);Buffer.BlockCopy(encoded,0,after,bom,encoded.Length);
            Directory.CreateDirectory(directory);string backup=Path.Combine(directory,"qualityconfig-"+Guid.NewGuid().ToString("N")+".before-restore");
            using(FileStream b=new FileStream(backup,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {b.Write(before,0,before.Length);b.Flush(true);}
            if(FileHash(backup)!=Hash(before))throw new IOException("配置备份校验失败。");
            return new NativeFpsConfigEdit {Stream=f,Before=before,After=after,Backup=backup};
        }
        catch {f.Dispose();throw;}
    }
    internal Dictionary<string,object> Restore(string input)
    {
        string root=Resolve(input);EnsureStopped();
        if(!FixedCompatible(root)) return AdaptiveRestore(root);
        using(Mutex mutex=new Mutex(false,"Local\\Native240OptionV03-"+Hash(Encoding.UTF8.GetBytes(root.ToUpperInvariant())).Substring(0,20)))
        {
            if(!mutex.WaitOne(0))throw new IOException("另一个工具正在操作此包体。");
            try
            {
                FileStream[] f=Open(root,true);
                try
                {
                    string state=Inspect(f);
                    byte[][] before=slots.Select(s=>ReadAt(f[s.Archive],s.Offset,s.Length)).ToArray();
                    string[] beforeHashes=Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,0)).ToArray();
                    string dir=Path.Combine(BackupDirectory(root),DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-restore-"+Guid.NewGuid().ToString("N").Substring(0,8));
                    Directory.CreateDirectory(dir);
                    if(state!="official")
                    {
                        if(new DriveInfo(Path.GetPathRoot(dir)).AvailableFreeSpace<Lengths.Sum()+64L*1024*1024)
                            throw new IOException("游戏目录所在磁盘空间不足，无法建立恢复前备份。");
                        for(int i=0;i<2;i++) Backup(f[i],Path.Combine(dir,FileNames[i]+".before-restore"),beforeHashes[i]);
                    }
                    NativeFpsConfigEdit config=PrepareConfig(root,dir);
                    try
                    {
                        EnsureStopped();AdaptiveCheckNoNewerPart(root);foreach(NativeFpsSlot s in slots)WriteAt(f[s.Archive],s.Offset,s.Old);
                        foreach(FileStream stream in f)stream.Flush(true);
                        if(Inspect(f)!="official" || !Same(Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,0)).ToArray(),Expected))
                            throw new IOException("恢复后整包校验失败。");
                        if(config!=null) {WriteAt(config.Stream,0,config.After);config.Stream.SetLength(config.After.Length);config.Stream.Flush(true);
                            if(Hash(ReadAt(config.Stream,0,config.After.Length))!=Hash(config.After))throw new IOException("帧率配置恢复校验失败。");}
                        return Result(root,"official","已恢复原始包体。"+(config!=null?"新增帧率档位已恢复到原有 120 档。":""),dir);
                    }
                    catch
                    {
                        for(int i=0;i<slots.Length;i++)WriteAt(f[slots[i].Archive],slots[i].Offset,before[i]);
                        foreach(FileStream stream in f)stream.Flush(true);
                        if(config!=null){WriteAt(config.Stream,0,config.Before);config.Stream.SetLength(config.Before.Length);config.Stream.Flush(true);}
                        if(!Same(Enumerable.Range(0,2).Select(i=>ArchiveHash(f[i],i,0)).ToArray(),beforeHashes))
                            throw new IOException("恢复失败且回滚校验失败；请勿启动游戏并保留备份。");
                        throw;
                    }
                    finally {if(config!=null)config.Stream.Dispose();}
                }
                finally {Close(f);}
            }
            finally {mutex.ReleaseMutex();}
        }
    }
}


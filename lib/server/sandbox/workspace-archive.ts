import 'server-only';
import { SandboxError } from '@/lib/sandbox/errors';

export const WORKSPACE_ROOT = '/home/user/project';
export const WORKSPACE_EXCLUDES = ['node_modules', '.next', 'target', '__pycache__', '.venv'];
function invalid(): never {
  throw new SandboxError('SANDBOX_ARCHIVE_INVALID', 422, 'Project path is invalid.');
}
export function workspacePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.length > 2048
  )
    return invalid();
  const relative = value.startsWith(WORKSPACE_ROOT + '/')
    ? value.slice(WORKSPACE_ROOT.length + 1)
    : value;
  if (
    !relative ||
    relative.startsWith('/') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    return invalid();
  return relative;
}
export const WORKSPACE_FILE_RUNNER = String.raw`
import os, sys, stat, base64
try:
    root='/home/user/project'
    mode, encoded, transfer=sys.argv[1:]
    parts=base64.b64decode(encoded).decode().split('/')
    if any(p in ('','.','..') for p in parts): raise ValueError('path')
    os.makedirs(root,exist_ok=True)
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            if mode=='write':
                try: os.mkdir(part,0o700,dir_fd=fd)
                except FileExistsError: pass
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd); fd=child
        name=parts[-1]
        if mode=='read':
            src=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
            with os.fdopen(src,'rb') as source:
                info=os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1: raise ValueError('file')
                data=source.read(1048577)
            if len(data)>1048576: raise ValueError('size')
            data.decode('utf-8')
            with open(transfer,'xb') as out: out.write(data)
        elif mode=='write':
            with open(transfer,'rb') as source: data=source.read(1048577)
            if len(data)>1048576: raise ValueError('size')
            data.decode('utf-8')
            try:
                info=os.stat(name,dir_fd=fd,follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1: raise ValueError('file')
                permissions=stat.S_IMODE(info.st_mode)
            except FileNotFoundError: permissions=0o600
            temp='.openmaic-write-'+os.urandom(16).hex()
            try:
                dst=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,permissions,dir_fd=fd)
                with os.fdopen(dst,'wb') as out: out.write(data)
                os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd)
            finally:
                try: os.unlink(temp,dir_fd=fd)
                except FileNotFoundError: pass
        else: raise ValueError('action')
    finally: os.close(fd)
except FileNotFoundError: sys.exit(44)
except UnicodeDecodeError: sys.exit(45)
except (ValueError, OSError): sys.exit(46)
`;

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
export function encodeWindowsIcon(frames: Buffer[]): Buffer {
  if (!frames.length || frames.length > 16) throw new Error('An icon needs 1–16 PNG frames.');
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  const seen = new Set<number>();
  let offset = header.length;
  frames.forEach((frame, index) => {
    if (frame.length < 33 || !frame.subarray(0,8).equals(pngSignature) || frame.toString('ascii',12,16) !== 'IHDR') throw new Error('Invalid PNG icon frame.');
    const size = frame.readUInt32BE(16);
    if (size !== frame.readUInt32BE(20) || size < 1 || size > 256 || seen.has(size) || frame.length > 4 * 1024 * 1024) throw new Error('Icon frames must be unique square PNGs up to 256px.');
    seen.add(size);
    const entry = 6 + 16 * index;
    header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  return Buffer.concat([header, ...frames]);
}

// Fixed PowerShell source: all user paths travel as environment values, not executable text.
export const shortcutPowerShell = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = $env:EVOMEME_SHORTCUT_ROOT
if ($env:EVOMEME_SHORTCUT_ACTION -eq 'prepare') {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $source = $env:EVOMEME_ICON_SOURCE
    if ([string]::IsNullOrWhiteSpace($source)) {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = 'Choose your Mimo image for the EvoMeme shortcut'
        $dialog.Filter = 'Images (*.png;*.jpg;*.jpeg;*.bmp;*.ico)|*.png;*.jpg;*.jpeg;*.bmp;*.ico'
        $dialog.InitialDirectory = $root
        $dialog.CheckFileExists = $true
        try {
            if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
                [pscustomobject]@{ cancelled = $true } | ConvertTo-Json -Compress
                exit 0
            }
            $source = $dialog.FileName
        } finally { $dialog.Dispose() }
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'The selected image does not exist.' }
    $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
    if ($extension -eq '.ico') {
        [pscustomobject]@{ kind = 'ico'; source = $source } | ConvertTo-Json -Compress
        exit 0
    }
    if ($extension -notin @('.png','.jpg','.jpeg','.bmp')) { throw 'Choose a PNG, JPG, BMP or ICO file.' }
    $image = [System.Drawing.Image]::FromFile($source)
    try {
        foreach ($size in @(16,32,48,256)) {
            $bitmap = [System.Drawing.Bitmap]::new($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $ratio = [Math]::Min($size / [double]$image.Width, $size / [double]$image.Height)
                $width = [Math]::Max(1,[int][Math]::Round($image.Width * $ratio))
                $height = [Math]::Max(1,[int][Math]::Round($image.Height * $ratio))
                $rectangle = [System.Drawing.Rectangle]::new([int](($size-$width)/2),[int](($size-$height)/2),$width,$height)
                $graphics.DrawImage($image,$rectangle)
                $bitmap.Save((Join-Path $env:EVOMEME_ICON_TEMP ($size.ToString()+'.png')),[System.Drawing.Imaging.ImageFormat]::Png)
            } finally { $graphics.Dispose(); $bitmap.Dispose() }
        }
    } finally { $image.Dispose() }
    [pscustomobject]@{ kind = 'frames' } | ConvertTo-Json -Compress
    exit 0
}
if ($env:EVOMEME_SHORTCUT_ACTION -ne 'create') { throw 'Unknown shortcut action.' }
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop -PathType Container)) { throw 'The Windows Desktop folder could not be found.' }
$target = Join-Path $root 'Start.cmd'
$linkPath = Join-Path $desktop 'Mimo - EvoMeme.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
if ((Test-Path -LiteralPath $linkPath) -and -not [string]::Equals($link.TargetPath,$target,[StringComparison]::OrdinalIgnoreCase)) { throw 'A different Mimo - EvoMeme shortcut already exists. Rename it before retrying.' }
$link.TargetPath = $target
$link.WorkingDirectory = $root
$link.IconLocation = $env:EVOMEME_ICON_OUTPUT + ',0'
$link.Description = 'Start EvoMeme with Mimo: console, API, Bot and Worker.'
$link.Hotkey = 'CTRL+ALT+M'
$link.WindowStyle = 1
$link.Save()
[pscustomobject]@{ shortcutPath = $linkPath; hotkey = 'Ctrl + Alt + M' } | ConvertTo-Json -Compress
`;

export async function createDesktopShortcut(root: string, image?: string) {
  if (process.platform !== 'win32') throw new Error('Desktop shortcuts must be created on your Windows computer.');
  if (!existsSync(join(root,'Start.cmd'))) throw new Error('Run this tool from a complete EvoMeme project containing Start.cmd.');
  const directory = join(root,'.data','launcher');
  await mkdir(directory, { recursive: true });
  const output = join(directory,'mimo.ico');
  const temporary = await mkdtemp(join(tmpdir(),'evomeme-icon-'));
  const source = image ?? [join(root,'assets','mimo.png'),join(root,'mimo.png'),join(root,'assets','mimo.ico'),output].find(path => existsSync(path));
  const env = { ...process.env, EVOMEME_SHORTCUT_ROOT: root, EVOMEME_ICON_SOURCE: source ?? '', EVOMEME_ICON_OUTPUT: output, EVOMEME_ICON_TEMP: temporary };
  async function run(action: string) {
    try {
      const { stdout } = await execute('powershell.exe', ['-NoLogo','-NoProfile','-STA','-Command',shortcutPowerShell], { windowsHide: true, env: { ...env, EVOMEME_SHORTCUT_ACTION: action }, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout.trim()) as { cancelled?: boolean; kind?: string; source?: string; shortcutPath?: string; hotkey?: string };
    } catch { throw new Error('Could not create the shortcut. Check the image, desktop permissions, and whether a different Mimo shortcut already exists. No services were started.'); }
  }
  try {
    console.log('Choose the saved Mimo picture if the file picker appears. Cancel leaves the shortcut unchanged.');
    const prepared = await run('prepare');
    if (prepared.cancelled) { console.log('Cancelled. No desktop shortcut was created.'); return; }
    if (prepared.kind === 'ico' && prepared.source) {
      const buffer = await readFile(prepared.source);
      if (buffer.length < 22 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1 || buffer.readUInt16LE(4) < 1) throw new Error('The selected ICO file is invalid.');
      if (prepared.source !== output) await writeFile(output, buffer);
    } else if (prepared.kind === 'frames') {
      const frames = await Promise.all([16,32,48,256].map(size => readFile(join(temporary,`${size}.png`))));
      await writeFile(output, encodeWindowsIcon(frames));
    } else throw new Error('No icon was generated.');
    const result = await run('create');
    console.log(`Desktop shortcut created: ${result.shortcutPath}`);
    console.log(`Hotkey: ${result.hotkey}. Double-click the Mimo icon or press the hotkey to start EvoMeme.`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

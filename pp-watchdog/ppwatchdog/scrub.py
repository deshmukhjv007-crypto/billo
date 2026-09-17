"""EXIF / GPS stripping for the photo you are about to make your profile picture.

Pure stdlib, marker-level edits, pixels untouched. Use this *before* uploading:
it does nothing about a mirror that already has your old photo, but it guarantees
the next copy they cache carries no location and no camera serial.
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass
from pathlib import Path

_STRIP_JPEG_MARKERS = {
    0xE1,  # EXIF
    0xE2,  # ICC sometimes; kept by default below
    0xED,  # Photoshop IRB
    0xEE,  # Adobe
    0xFE,  # comment
    0xEA,  # XMP
    0xEB,  # MPF (thumbnail chain)
}
_KEEP_ICC = True

_PNG_TEXT_CHUNKS = {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}

_GPS_TAG_RE = re.compile(rb"(GPSInfo|GPSLatitude|GPSLongitude|GPSCoordinates)")


@dataclass
class Audit:
    path: Path
    kind: str = "unknown"
    size: tuple[int, int] = (0, 0)
    leaks: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.leaks is None:
            self.leaks = []

    @property
    def dirty(self) -> bool:
        return bool(self.leaks)


def audit(path: Path) -> Audit:
    data = path.read_bytes()
    from .imaging import image_size

    a = Audit(path=path, size=image_size(data) or (0, 0))
    if data[:2] == b"\xff\xd8":
        a.kind = "jpeg"
        segs = _jpeg_segments(data)
        for marker, start, end in segs:
            if marker == 0xE1 and b"Exif" in data[start:end]:
                a.leaks.append("EXIF block (camera, lens, timestamps, orientation)")
            elif marker == 0xEA:
                a.leaks.append("XMP packet")
            elif marker == 0xED:
                a.leaks.append("Photoshop IRB")
            elif marker == 0xFE:
                a.leaks.append(f"JPEG comment: {data[start:end][:60].decode(errors='ignore')!r}")
        if _GPS_TAG_RE.search(data):
            a.leaks.append("GPS coordinates")
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        a.kind = "png"
        for kind, start, end in _png_chunks(data):
            if kind in _PNG_TEXT_CHUNKS:
                a.leaks.append(f"PNG {kind.decode()} chunk")
    elif data[:6] in (b"GIF87a", b"GIF89a"):
        a.kind = "gif"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        a.kind = "webp"
        if _GPS_TAG_RE.search(data[:200_000]):
            a.leaks.append("metadata containing GPS keys")
    return a


def _jpeg_segments(data: bytes) -> list[tuple[int, int, int]]:
    out: list[tuple[int, int, int]] = []
    i = 2
    n = len(data)
    while i < n - 1:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker == 0xD9 or marker == 0xDA:  # EOI / SOS: stop walking segments
            out.append((marker, i + 2, n))
            break
        if marker in (0x01,) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if i + 4 > n:
            break
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        out.append((marker, i + 4, i + 2 + seglen))
        i += 2 + seglen
    return out


def _png_chunks(data: bytes) -> list[tuple[bytes, int, int]]:
    out: list[tuple[bytes, int, int]] = []
    i = 8
    while i + 8 <= len(data):
        length = struct.unpack(">I", data[i : i + 4])[0]
        kind = data[i + 4 : i + 8]
        start = i + 8
        out.append((kind, start, start + length))
        i = start + length + 4
    return out


def scrub(src: Path, dst: Path | None = None, *, keep_icc: bool = _KEEP_ICC) -> tuple[Path, list[str]]:
    """Rewrite `src` without metadata. Returns (written path, removed items)."""
    data = src.read_bytes()
    removed: list[str] = []
    if data[:2] == b"\xff\xd8":
        out = bytearray(b"\xff\xd8")
        n = len(data)
        i = 2
        while i < n - 1:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker == 0xDA:  # scan data: copy the rest verbatim
                out += data[i:]
                break
            if marker == 0xD9:
                out += data[i:]
                break
            if marker == 0x01 or 0xD0 <= marker <= 0xD7:
                out += data[i : i + 2]
                i += 2
                continue
            seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
            seg = data[i : i + 2 + seglen]
            drop = marker in _STRIP_JPEG_MARKERS and not (keep_icc and marker == 0xE2)
            if drop:
                removed.append(f"JPEG marker 0x{marker:02X} ({seglen - 2} bytes)")
            else:
                out += seg
            i += 2 + seglen
        if b"\xff\xd9" not in out[-4:]:
            out += b"\xff\xd9"
        result = bytes(out)
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        out = bytearray(data[:8])
        i = 8
        while i + 8 <= len(data):
            length = struct.unpack(">I", data[i : i + 4])[0]
            kind = data[i + 4 : i + 8]
            end = i + 8 + length + 4
            if kind in _PNG_TEXT_CHUNKS:
                removed.append(f"PNG {kind.decode()} chunk ({length} bytes)")
            else:
                out += data[i:end]
            i = end
        if data[-12:-8] != b"IEND":
            out += struct.pack(">I", 0) + b"IEND" + struct.pack(">I", 0xAE426082)
        result = bytes(out)
    else:
        raise SystemExit(
            f"{src.name}: only JPEG and PNG can be scrubbed losslessly by this tool.\n"
            "  For GIF/WEBP/HEIC, re-encode once with any editor that drops metadata, or use:\n"
            "    exiftool -all= -overwrite_original <file>"
        )
    dst = dst or src.with_name(src.stem + ".scrubbed" + src.suffix)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(result)
    verify = audit(dst)
    if verify.dirty:
        removed.append(f"WARN: {', '.join(verify.leaks)} still present after scrub")
    return dst, removed

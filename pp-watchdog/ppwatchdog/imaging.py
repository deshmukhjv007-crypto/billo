"""Image fingerprints with no required third-party dependencies.

We need three things:
  * an exact fingerprint (SHA-256)  -> byte-identical copy?
  * dimensions (w x h)              -> are they serving a bigger crop than
                                        Instagram shows you?
  * a perceptual hash               -> same *photo*, re-encoded/resized?

Dimensions and perceptual hashing are done from the raw bytes. PNG and GIF are
parsed natively; JPEG via marker walk; WEBP via RIFF chunk peek. If Pillow is
installed we additionally get a difference hash (dHash), which survives
re-encoding and resizing -- otherwise we degrade gracefully and rely on exact
hash + dimensions.
"""

from __future__ import annotations

import hashlib
import io
import re
import struct
from dataclasses import dataclass, field

try:  # optional, and only used to sharpen the "is this my photo?" answer
    from PIL import Image  # type: ignore

    HAVE_PIL = True
except Exception:  # pragma: no cover - exercised on machines without Pillow
    Image = None  # type: ignore
    HAVE_PIL = False


# --------------------------------------------------------------------------- #
# fingerprints
# --------------------------------------------------------------------------- #
def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    idx = 8
    while idx + 8 <= len(data):
        length = struct.unpack(">I", data[idx : idx + 4])[0]
        kind = data[idx + 4 : idx + 8]
        if kind == b"IHDR":
            w, h = struct.unpack(">II", data[idx + 8 : idx + 16])
            return int(w), int(h)
        idx += 12 + length
    return None


def _gif_size(data: bytes) -> tuple[int, int] | None:
    if data[:6] not in (b"GIF87a", b"GIF89a"):
        return None
    w, h = struct.unpack("<HH", data[6:10])
    return int(w), int(h)


def _webp_size(data: bytes) -> tuple[int, int] | None:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    fourcc = data[12:16]
    try:
        if fourcc == b"VP8X" and len(data) >= 30:
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h
        if fourcc == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if fourcc == b"VP8 " and len(data) >= 30:
            w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return w, h
    except Exception:
        return None
    return None


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    if data[:2] != b"\xff\xd8":
        return None
    idx = 2
    limit = len(data) - 9
    while idx < limit:
        if data[idx] != 0xFF:
            idx += 1
            continue
        marker = data[idx + 1]
        # standalone markers
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            idx += 2
            continue
        if marker == 0xFF:  # padding
            idx += 1
            continue
        seglen = struct.unpack(">H", data[idx + 2 : idx + 4])[0]
        # SOF0..SOF15, excluding DHT(C4)/JPG(C8)/DAC(CC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[idx + 5 : idx + 9])
            return int(w), int(h)
        idx += 2 + seglen
    return None


def image_size(data: bytes) -> tuple[int, int] | None:
    for probe in (_png_size, _jpeg_size, _gif_size, _webp_size):
        size = probe(data)
        if size and size[0] > 0 and size[1] > 0:
            return size
    return None


def _dhash_8x8(gray) -> int | None:
    """dHash over a 9x8 downsample: robust to resize + re-encode."""
    try:
        small = gray.convert("L").resize((9, 8))
        px = small.tobytes()  # 9x8 'L' image: one byte per pixel, row-major
    except Exception:
        return None
    bits = 0
    for row in range(8):
        base = row * 9
        for col in range(8):
            bits = (bits << 1) | (1 if px[base + col] < px[base + col + 1] else 0)
    return bits


def perceptual_hash(data: bytes) -> int | None:
    if not HAVE_PIL:
        return None
    try:
        img = Image.open(io.BytesIO(data))  # type: ignore[arg-type]
        img.load()
        return _dhash_8x8(img)
    except Exception:
        return None


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


# --------------------------------------------------------------------------- #
# EXIF / GPS scraping out of the bytes (so the report can say "this copy leaks X")
# --------------------------------------------------------------------------- #
_EXIF_STRINGS = re.compile(rb"[\x20-\x7e]{4,}")
_LOCATION_KEYS = (b"GPSLatitude", b"GPSLongitude", "GPSLatitude", "GPSLongitude")


def embedded_metadata_skim(data: bytes) -> list[str]:
    """Cheap, dependency-free peek at whether a mirrored copy carries metadata.

    We only ever surface *whether* location/camera data survived into the
    mirror, never dump full EXIF into a report -- a takedown pack gets copied
    around and should not itself become a leak.
    """
    found: list[str] = []
    if data[:2] == b"\xff\xd8":
        for marker in (b"Exif", b"GPSInfo", b"GPSVersion"):
            if marker in data[:256_000]:
                found.append(marker.decode(errors="ignore"))
    if b"eXIf" in data or b"tEXt" in data or b"iTXt" in data:
        found.append("png-text-chunk")
    printable = _EXIF_STRINGS.findall(data[:64_000])
    cameras = [p for p in printable if re.match(rb"^(Make|Model|Canon|Nikon|SONY|SM-|iPhone|iPhone)", p)]
    for c in cameras[:3]:
        found.append(c.decode(errors="ignore"))
    return sorted(set(found))[:8]


@dataclass
class Fingerprint:
    data: bytes = field(repr=False, default=b"")
    sha256: str = ""
    width: int = 0
    height: int = 0
    phash: int | None = None
    meta_markers: list[str] = field(default_factory=list)
    error: str = ""

    @property
    def megapixels(self) -> float:
        return round((self.width * self.height) / 1_000_000, 3)

    @property
    def has_image(self) -> bool:
        return bool(self.width and self.height)

    def to_dict(self) -> dict:
        return {
            "sha256": self.sha256,
            "width": self.width,
            "height": self.height,
            "phash": None if self.phash is None else f"{self.phash:016x}",
            "bytes": len(self.data),
            "meta_markers": self.meta_markers,
            "error": self.error,
        }


def fingerprint(data: bytes) -> Fingerprint:
    if not data:
        return Fingerprint(error="empty payload")
    size = image_size(data)
    fp = Fingerprint(
        data=data,
        sha256=sha256_hex(data),
        width=size[0] if size else 0,
        height=size[1] if size else 0,
        phash=perceptual_hash(data),
        meta_markers=embedded_metadata_skim(data),
    )
    if size is None:
        fp.error = "not a decodable raster (html/json/error page, or unsupported format)"
    return fp


@dataclass
class Comparison:
    """What we can honestly say about a mirror's copy vs your original.

    kinds:
      exact            byte-identical file
      same-photo       perceptually the same photograph (re-encoded/resized)
      different-photo  perceptually a different photograph  -> they are stale
      unidentifiable   we cannot tell, because Pillow is absent or a baseline is missing
    """

    kind: str
    detail: str
    bigger: bool = False
    dimensions: tuple[int, int] = (0, 0)

    @property
    def confirmed(self) -> bool:
        return self.kind in ("exact", "same-photo", "different-photo")


def compare(baseline: Fingerprint | None, other: Fingerprint) -> Comparison:
    if not other.has_image:
        return Comparison("unidentifiable", other.error or "payload is not a decodable image")
    dims = (other.width, other.height)
    if baseline is None or not baseline.has_image:
        return Comparison(
            "unidentifiable",
            "no baseline image supplied, so 'old vs current' cannot be judged — set "
            "baseline_image in the config",
            bigger=_bigger(other, baseline), dimensions=dims,
        )
    if other.sha256 == baseline.sha256:
        return Comparison("exact", "byte-identical copy of the file you uploaded",
                          dimensions=dims)
    bigger = _bigger(other, baseline)
    if baseline.phash is not None and other.phash is not None:
        dist = hamming(baseline.phash, other.phash)
        size_note = (f", served at {other.width}x{other.height} vs your "
                     f"{baseline.width}x{baseline.height}") if dims != (baseline.width, baseline.height) else ""
        if dist <= 6:
            return Comparison("same-photo",
                              f"dHash distance {dist}/64: the same photograph, re-encoded{size_note}",
                              bigger=bigger, dimensions=dims)
        return Comparison("different-photo",
                          f"dHash distance {dist}/64: a different photograph{size_note} — this is "
                          f"an older picture of you", bigger=bigger, dimensions=dims)
    return Comparison(
        "unidentifiable",
        f"file differs from yours ({other.width}x{other.height}) but perceptual matching needs "
        "Pillow, so old-vs-current is unconfirmed — verify by eye (pip install pillow to fix this)",
        bigger=bigger, dimensions=dims,
    )


def _bigger(a: Fingerprint, b: Fingerprint | None) -> bool:
    if b is None or not b.has_image or not a.has_image:
        return False
    return (a.width * a.height) > (b.width * b.height)

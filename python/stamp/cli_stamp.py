"""CLI bridge for the PixInsight script (IAStamp.js): stamps out a masked
region on a LINEAR astro crop and writes the result back to disk.

PJSR (PixInsight's JS engine) can't run PyTorch/LaMa itself, so the .js
script shells out to this script (via PixInsight's ExternalProcess) and
exchanges data through plain single-channel FITS files -- one per
channel, never a multi-channel cube, so there's no ambiguity about axis
order between PixInsight's FITS writer and astropy's reader.

Usage:
    python.exe cli_stamp.py --channels crop_c0.fits[,crop_c1.fits,crop_c2.fits]
        --mask mask.fits --out-channels out_c0.fits[,out_c1.fits,out_c2.fits]
        --engine lama|classical
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from astropy.io import fits
from PIL import Image

SRC_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SRC_DIR))

from stamp.classical_engine import inpaint_classical  # noqa: E402
from stamp.linear_stretch import forward_stretch, inverse_stretch  # noqa: E402
from stamp.region import feather_paste, match_noise  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--channels", required=True, help="comma-separated input FITS paths, 1 (mono) or 3 (RGB)")
    ap.add_argument("--mask", required=True, help="single-channel FITS path, >0 = area to fill")
    ap.add_argument("--out-channels", required=True, help="comma-separated output FITS paths, same count as --channels")
    ap.add_argument("--engine", choices=["lama", "classical"], default="lama")
    ap.add_argument("--opacity", type=float, default=1.0, help="0-1, blend strength of the stamp")
    ap.add_argument(
        "--feather-pct", type=float, default=25.0,
        help="edge softness as a %% of the painted area's own equivalent radius, not a fixed pixel count "
             "-- a fixed pixel value looks fine on a small dab but leaves an obvious hard edge on a big one",
    )
    args = ap.parse_args()

    in_paths = args.channels.split(",")
    out_paths = args.out_channels.split(",")
    if len(in_paths) not in (1, 3) or len(out_paths) != len(in_paths):
        raise ValueError("--channels must list 1 or 3 files, matching --out-channels count")

    channels = [fits.getdata(p).astype(np.float32) for p in in_paths]
    crop = channels[0] if len(channels) == 1 else np.stack(channels, axis=-1)
    is_mono = len(channels) == 1

    mask_raw = fits.getdata(args.mask)
    mask_bool = mask_raw > (0.5 * np.nanmax(mask_raw) if np.nanmax(mask_raw) > 0 else 0.5)
    if not mask_bool.any():
        raise ValueError("mask is empty -- nothing to stamp")
    valid_mask = ~mask_bool
    mask_u8 = (mask_bool * 255).astype(np.uint8)

    stretched, params = forward_stretch(crop, valid_mask)
    rgb8 = np.stack([stretched] * 3, axis=-1) if is_mono else stretched

    if args.engine == "lama":
        from stamp.lama_engine import LamaEngine

        engine = LamaEngine()
        result_rgb8 = np.array(engine.inpaint(Image.fromarray(rgb8), Image.fromarray(mask_u8)))
    else:
        result_rgb8 = inpaint_classical(rgb8, mask_u8)

    if is_mono:
        result_mono8 = result_rgb8.mean(axis=-1).astype(np.uint8)
        result_linear = inverse_stretch(result_mono8, params)
    else:
        result_linear = inverse_stretch(result_rgb8, params)

    result_linear = match_noise(crop, result_linear, mask_u8, valid_mask)

    # Equivalent-area radius of the painted region, so "feather" scales with
    # whatever was actually painted (a single big dab or several small ones)
    # instead of leaving a hard edge on large strokes or eating a small one alive.
    mask_radius = float(np.sqrt(mask_bool.sum() / np.pi))
    feather_px = (args.feather_pct / 100.0) * mask_radius

    merged = feather_paste(
        crop, result_linear, mask_u8,
        feather_px=feather_px, opacity=args.opacity,
        clip_range=None, out_dtype=np.float32,
    )

    out_channels = [merged] if is_mono else [merged[..., c] for c in range(merged.shape[-1])]
    for arr, out_path in zip(out_channels, out_paths):
        fits.writeto(out_path, arr.astype(np.float32), overwrite=True)

    print("STAMP_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 -- surfaced to the calling PJSR script via stderr + exit code
        print(f"STAMP_ERROR: {exc}", file=sys.stderr)
        raise

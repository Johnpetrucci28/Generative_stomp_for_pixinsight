"""Reversible stretch between linear astro data and 8-bit, for handing a
crop to an 8-bit-trained inpainting network (LaMa) and getting a linear
result back.

LaMa was trained on ordinary 8-bit photos, so it can't make sense of a
linear FITS crop handed to it directly (linear astro data is almost all
near-zero background with a tiny bright tail -- naive 8-bit encoding
would look flat black and destroy the very noise texture we want
reproduced). An asinh stretch, parameterized from the crop's own
background/noise statistics, brings it into a usable 8-bit range; the
exact inverse restores real linear values afterwards.

Stats are computed from the UNMASKED reference pixels only, so a bright
halo under the mask doesn't bias the background/noise estimate.
"""
from __future__ import annotations

import numpy as np

_SIGMA_FLOOR = 1e-12


def _channel_params(x: np.ndarray, valid: np.ndarray) -> dict:
    ref = x[valid] if valid.any() else x.ravel()
    bg = float(np.median(ref))
    mad = float(np.median(np.abs(ref - bg)))
    sigma = max(1.4826 * mad, _SIGMA_FLOOR)
    z = (ref - bg) / sigma
    y = np.arcsinh(z)
    lo, hi = np.percentile(y, [0.5, 99.9])
    span = hi - lo
    hi = hi + 0.25 * span if span > 0 else hi + 1.0
    if hi <= lo:
        hi = lo + 1.0
    return {"bg": bg, "sigma": sigma, "lo": float(lo), "hi": float(hi)}


def forward_stretch(crop: np.ndarray, valid_mask: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """crop: HxW or HxWxC float32 linear data. valid_mask: HxW bool, True
    where the pixel is real reference data (NOT inside the area to fill).
    Returns (uint8 array same spatial shape, one params dict per channel)."""
    is_mono = crop.ndim == 2
    channels = [crop] if is_mono else [crop[..., c] for c in range(crop.shape[-1])]

    out_channels = []
    params_list = []
    for ch in channels:
        params = _channel_params(ch, valid_mask)
        z = (ch - params["bg"]) / params["sigma"]
        y = np.arcsinh(z)
        y_norm = np.clip((y - params["lo"]) / (params["hi"] - params["lo"]), 0, 1)
        out_channels.append((y_norm * 255).astype(np.uint8))
        params_list.append(params)

    out = out_channels[0] if is_mono else np.stack(out_channels, axis=-1)
    return out, params_list


def inverse_stretch(result_uint8: np.ndarray, params_list: list[dict]) -> np.ndarray:
    """Inverse of forward_stretch. result_uint8: HxW or HxWxC uint8."""
    is_mono = result_uint8.ndim == 2
    channels = [result_uint8] if is_mono else [result_uint8[..., c] for c in range(result_uint8.shape[-1])]

    out_channels = []
    for ch, params in zip(channels, params_list):
        y_norm = ch.astype(np.float32) / 255.0
        y = params["lo"] + y_norm * (params["hi"] - params["lo"])
        z = np.sinh(y)
        x = params["bg"] + z * params["sigma"]
        out_channels.append(x.astype(np.float32))

    return out_channels[0] if is_mono else np.stack(out_channels, axis=-1)

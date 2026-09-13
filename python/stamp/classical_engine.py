"""Classical, weight-free inpainting fallback (OpenCV Telea / Navier-Stokes).

No external data or trained weights involved -- pure signal-processing
algorithm shipped inside OpenCV (Apache 2.0). Useful for small retouches
or as a safety net when LaMa isn't available.
"""
from __future__ import annotations

import cv2
import numpy as np


def inpaint_classical(
    image_rgb: np.ndarray, mask: np.ndarray, method: str = "telea", radius: int = 5
) -> np.ndarray:
    """image_rgb: HxWx3 uint8. mask: HxW uint8, 255 = area to fill."""
    flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
    bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, mask, radius, flag)
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)

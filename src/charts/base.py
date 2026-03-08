from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib
from matplotlib.figure import Figure
from matplotlib.axes import Axes

from src.config import CHART_STYLE, OUTPUT_DIR

# Use non-interactive backend (for headless server / GitHub Actions)
matplotlib.use("Agg")


class F1Chart:
    """Base class for all F1 charts with consistent dark-theme styling."""

    def __init__(self, title: str, width: float = 14, height: float = 9):
        self.title = title
        self.width = width
        self.height = height
        self.style = CHART_STYLE

    def setup(self) -> tuple[Figure, Axes]:
        """Create a styled figure and axes."""
        plt.style.use("dark_background")

        fig, ax = plt.subplots(figsize=(self.width, self.height))
        fig.set_facecolor(self.style["bg_color"])
        ax.set_facecolor(self.style["axes_color"])

        # Grid
        ax.grid(True, linestyle="--", alpha=0.2, color=self.style["grid_color"])
        ax.set_axisbelow(True)

        # Title
        ax.set_title(
            self.title,
            fontsize=self.style["title_size"],
            fontweight="bold",
            color=self.style["text_color"],
            pad=20,
        )

        # Tick styling
        ax.tick_params(
            colors=self.style["text_color"],
            labelsize=self.style["tick_size"],
        )

        # Spine styling
        for spine in ax.spines.values():
            spine.set_color(self.style["grid_color"])
            spine.set_linewidth(0.5)

        return fig, ax

    def add_watermark(self, fig: Figure):
        """Add subtle branding watermark."""
        fig.text(
            0.98, 0.02,
            self.style["watermark"],
            fontsize=9,
            color=self.style["text_color"],
            alpha=0.3,
            ha="right",
            va="bottom",
            fontstyle="italic",
        )

    def save(self, fig: Figure, filename: str) -> Path:
        """Save figure to output directory as high-DPI PNG."""
        OUTPUT_DIR.mkdir(exist_ok=True)
        path = OUTPUT_DIR / f"{filename}.png"
        fig.savefig(
            path,
            dpi=self.style["dpi"],
            bbox_inches="tight",
            pad_inches=0.4,
            facecolor=fig.get_facecolor(),
            edgecolor="none",
        )
        plt.close(fig)
        return path

    def finalize(self, fig: Figure, ax: Axes, filename: str) -> Path:
        """Add watermark and save."""
        self.add_watermark(fig)
        return self.save(fig, filename)

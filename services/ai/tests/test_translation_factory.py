import pytest

from mawiid_ai.translation import factory
from mawiid_ai.translation.config import MadladSettings, TranslationSettings
from mawiid_ai.translation.factory import load_engines


def test_missing_model_is_a_clear_startup_error(tmp_path):
    settings = TranslationSettings(madlad=MadladSettings(model_path=str(tmp_path / "missing")), engines=["madlad"])
    with pytest.raises(RuntimeError, match="convert_translation_model"):
        load_engines(settings)


class GpuOutOfMemoryEngine:
    """Stands in for MadladEngine on a GPU that is too full to hold the model."""

    def __init__(self, settings: MadladSettings, name: str = "madlad") -> None:
        if settings.device != "cpu":
            raise RuntimeError("CUDA failed with error out of memory")
        self.name, self.device = name, "cpu"


def test_auto_device_falls_back_to_cpu_when_the_gpu_cannot_hold_the_model(monkeypatch):
    monkeypatch.setattr(factory, "MadladEngine", GpuOutOfMemoryEngine)
    engines = load_engines(TranslationSettings(madlad=MadladSettings(device="auto"), engines=["madlad"]))
    assert engines["madlad"].device == "cpu"


def test_load_errors_name_the_real_cause(monkeypatch):
    monkeypatch.setattr(factory, "MadladEngine", GpuOutOfMemoryEngine)
    settings = TranslationSettings(madlad=MadladSettings(device="cuda"), engines=["madlad"])  # GPU explicitly required
    with pytest.raises(RuntimeError, match="out of memory"):
        load_engines(settings)

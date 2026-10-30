"""LiveKit worker for live captions: transcribes each speaker in a room and sends every
listener subtitles in their own language (docs/live-chat-plan.md section 11).

    python -m mawiid_ai.agent dev
"""

from mawiid_ai.agent.pipeline import RoomPipeline, Segment, mawiid_language
from mawiid_ai.agent.uploader import TranscriptUploader

__all__ = ["RoomPipeline", "Segment", "TranscriptUploader", "mawiid_language"]

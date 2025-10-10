import json
import os

def extract_audio(config_path="config.json"):
    try:
        from pydub import AudioSegment
    except ImportError as e:
        print(f"[WARNING] 无法导入pydub: {e}")
        print("[WARNING] 跳过音频处理步骤")
        return
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    audio_cfg = config.get("audio_processing", {})

    input_file = audio_cfg.get("input_audio", "htmls/audios/test.wav")
    output_file = audio_cfg.get("output_audio", "htmls/audios/audio_clip.mp3")
    clip_length = audio_cfg.get("clip_length", 10)  # 秒
    start_sec = audio_cfg.get("start_sec", 0)
    end_sec = start_sec + clip_length

    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    start_ms = start_sec * 1000
    end_ms = end_sec * 1000

    audio = AudioSegment.from_file(input_file)
    segment = audio[start_ms:end_ms]
    segment.export(output_file, format=os.path.splitext(output_file)[1][1:]) 

    print(f"已提取片段: {output_file}, 时长: {clip_length} 秒")


if __name__ == "__main__":
    extract_audio()

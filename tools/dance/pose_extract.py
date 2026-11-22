"""Video -> per-frame 3D skeleton (MediaPipe Pose heavy, world + image landmarks).
usage: python -I pose_extract.py <video.mp4> <out.npz> <model.task>
"""
import sys
import cv2
import numpy as np
import mediapipe as mp

video, out, model = sys.argv[1:4]
BaseOptions = mp.tasks.BaseOptions
PL, PLO = mp.tasks.vision.PoseLandmarker, mp.tasks.vision.PoseLandmarkerOptions
opts = PLO(base_options=BaseOptions(model_asset_path=model), running_mode=mp.tasks.vision.RunningMode.VIDEO,
           num_poses=1, min_pose_detection_confidence=0.5, min_tracking_confidence=0.5)
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
world, img, ok = [], [], []
with PL.create_from_options(opts) as lm:
    i = 0
    while True:
        r, frame = cap.read()
        if not r:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
        if res.pose_world_landmarks:
            world.append([[p.x, p.y, p.z, p.visibility] for p in res.pose_world_landmarks[0]])
            img.append([[p.x * W, p.y * H, p.z * W, p.visibility] for p in res.pose_landmarks[0]])
            ok.append(1)
        else:
            world.append(np.zeros((33, 4)).tolist()); img.append(np.zeros((33, 4)).tolist()); ok.append(0)
        i += 1
        if i % 600 == 0:
            print(i, flush=True)
np.savez_compressed(out, world=np.array(world, np.float32), img=np.array(img, np.float32), ok=np.array(ok), fps=fps, size=(W, H))
print('frames', i, 'detected', sum(ok))

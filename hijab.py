from flask import Flask, request, send_file, jsonify
import threading
import uuid
import os
from datetime import datetime
import logging
from PIL import Image, ImageDraw, ImageFilter 
import io
import requests
from facenet_pytorch import MTCNN
import torch
import numpy as np

app = Flask(__name__)

# Configuration
UPLOAD_FOLDER = "./uploads"
VISUALIZATION_FOLDER = "./output/visualizations"
CROPPED_FOLDER = "./output/cropped"
LOG_FILE = "./logs/api.log"
HIJAB_MODEL_URL = "https://hijab-model.onrender.com/predict"  
DEVICE = "cpu"  # MTCNN runs on CPU
CONFIDENCE_THRESHOLD = 0.95
TASKS = {}  # Store task status and results

# Ensure directories exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(VISUALIZATION_FOLDER, exist_ok=True)
os.makedirs(CROPPED_FOLDER, exist_ok=True)
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

# Setup logging
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format="%(asctime)s - %(message)s")

# Initialize MTCNN
mtcnn = MTCNN(keep_all=True, device=DEVICE)

def expand_bbox(bbox, img_width, img_height):
    """Expand bounding box by 30% vertically and 10% horizontally, keep box centered, clamp to image boundaries."""
    x, y, w, h = bbox
    # Calculate center of the original box
    center_x = x + w / 2
    center_y = y + h / 2
    # New width and height
    new_w = int(w * 1.1)
    new_h = int(h * 1.3)
    # Calculate new top-left corner to keep box centered
    new_x = int(center_x - new_w / 2)
    new_y = int(center_y - new_h / 2)
    # Clamp to image boundaries
    new_x = max(0, new_x)
    new_y = max(0, new_y)
    new_x2 = min(img_width, new_x + new_w)
    new_y2 = min(img_height, new_y + new_h)
    # Adjust width and height if clamped
    new_w = new_x2 - new_x
    new_h = new_y2 - new_y
    return [new_x, new_y, new_w, new_h]

    # Optional debug
    print(f"Original: x={x}, y={y}, w={w}, h={h}")
    print(f"Expanded: x={new_x}, y={new_y}, w={final_w}, h={final_h}")
    
    return [new_x, new_y, final_w, final_h]




def gaussian_blur(image, bbox, radius=25):
    """Apply Gaussian blur to the specified region."""
    x, y, w, h = bbox
    region = image.crop((x, y, x + w, y + h))
    region = region.filter(ImageFilter.GaussianBlur(radius=radius))
    image.paste(region, (x, y))
    return image

def process_image(image_path, task_id):
    """Process image: detect faces, draw original and expanded boxes, crop, detect hijab, blur, and save results."""
    try:
        # Load image
        image = Image.open(image_path).convert("RGB")
        img_width, img_height = image.size
        image_np = np.array(image)

        # Detect faces
        boxes, probs = mtcnn.detect(image_np)
        if boxes is None or len(boxes) == 0:
            logging.info(f"Task {task_id}: No faces detected")
            TASKS[task_id] = {"status": "error", "message": "No faces detected"}
            return

        # Log all face probabilities
        logging.info(f"Task {task_id}: Detected {len(boxes)} faces with probabilities: {probs.tolist()}")

        # Filter valid faces
        valid_faces = [(box, prob) for box, prob in zip(boxes, probs) if prob >= CONFIDENCE_THRESHOLD]
        if not valid_faces:
            logging.info(f"Task {task_id}: No faces with confidence >= {CONFIDENCE_THRESHOLD}")
            TASKS[task_id] = {"status": "error", "message": f"No faces detected with confidence >= {CONFIDENCE_THRESHOLD}"}
            return

        # Draw original bounding boxes for visualization
        vis_image_original = image.copy()
        draw_original = ImageDraw.Draw(vis_image_original)
        for box, _ in valid_faces:
            x1, y1, x2, y2 = box
            draw_original.rectangle((x1, y1, x2, y2), outline="blue", width=2)
        
        # Save visualization image with original boxes
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        vis_original_filename = f"vis_original_{timestamp}_{task_id}.png"
        vis_original_path = os.path.join(VISUALIZATION_FOLDER, vis_original_filename)
        vis_image_original.save(vis_original_path)
        logging.info(f"Task {task_id}: Original visualization saved to {vis_original_path}")

        # Draw expanded bounding boxes for visualization
        vis_image_expanded = image.copy()
        draw_expanded = ImageDraw.Draw(vis_image_expanded)
        for box, _ in valid_faces:
            expanded_bbox = expand_bbox(box, img_width, img_height)
            x, y, w, h = expanded_bbox
            draw_expanded.rectangle((x, y, x + w, y + h), outline="red", width=2)
        
        # Save visualization image with expanded boxes
        vis_expanded_filename = f"vis_expanded_{timestamp}_{task_id}.png"
        vis_expanded_path = os.path.join(VISUALIZATION_FOLDER, vis_expanded_filename)
        vis_image_expanded.save(vis_expanded_path)
        logging.info(f"Task {task_id}: Expanded visualization saved to {vis_expanded_path}")

        # Process each valid face
        no_hijab_bboxes = []
        for idx, (box, _) in enumerate(valid_faces):
            # Expand bounding box
            expanded_bbox = expand_bbox(box, img_width, img_height)
            x, y, w, h = expanded_bbox

            # Crop expanded region
            cropped_image = image.crop((x, y, x + w, y + h))
            crop_filename = f"crop_face{idx}_{timestamp}_{task_id}.png"
            crop_path = os.path.join(CROPPED_FOLDER, crop_filename)
            cropped_image.save(crop_path)
            logging.info(f"Task {task_id}: Cropped face {idx} saved to {crop_path}")

            # Send to hijab detection model
            try:
                with open(crop_path, "rb") as f:
                    response = requests.post(HIJAB_MODEL_URL, files={"file": f}, timeout=60)
                response.raise_for_status()
                result = response.json()
                if not result.get("success") or "prediction" not in result:
                    raise ValueError("Invalid hijab model response")
                prediction = result["prediction"]
                label = prediction.get("label", "").lower().replace(" ", "-")  # Convert "Hijab" to "hijab", "No Hijab" to "no-hijab"
                confidence = prediction.get("confidence", 0.0)
                prob_hijab = prediction.get("probability_hijab", 0.0)
                prob_no_hijab = prediction.get("probability_no_hijab", 0.0)
                logging.info(
                    f"Task {task_id}: Face {idx} hijab detection result: "
                    f"label={label}, confidence={confidence}%, "
                    f"probability_hijab={prob_hijab}%, probability_no_hijab={prob_no_hijab}%"
                )
                if label == "no-hijab":
                    no_hijab_bboxes.append(expanded_bbox)
            except (requests.RequestException, ValueError) as e:
                logging.error(f"Task {task_id}: Hijab model failed for face {idx}: {str(e)}")
                TASKS[task_id] = {"status": "error", "message": f"Hijab model failed: {str(e)}"}
                return

        # Apply blur to no-hijab faces
        for bbox in no_hijab_bboxes:
            image = gaussian_blur(image, bbox)

        # Save final blurred image
        output_filename = f"output_{timestamp}_{task_id}.png"
        output_path = os.path.join(UPLOAD_FOLDER, output_filename)
        image.save(output_path)
        TASKS[task_id] = {"status": "completed", "output_path": output_path}

    except Exception as e:
        logging.error(f"Task {task_id}: Processing failed: {str(e)}")
        TASKS[task_id] = {"status": "error", "message": f"Processing failed: {str(e)}"}

@app.route("/process_image", methods=["POST"])
def process_image_endpoint():
    """Endpoint to upload and process an image."""
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    image_file = request.files["image"]
    if not image_file.filename:
        return jsonify({"error": "Invalid image file"}), 400

    # Save uploaded image
    task_id = str(uuid.uuid4())
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    image_path = os.path.join(UPLOAD_FOLDER, f"input_{timestamp}_{task_id}.png")
    image_file.save(image_path)
    logging.info(f"Task {task_id}: Image uploaded to {image_path}")

    # Start processing in a separate thread
    TASKS[task_id] = {"status": "processing"}
    threading.Thread(target=process_image, args=(image_path, task_id)).start()

    return jsonify({"task_id": task_id, "status": "processing"}), 202

@app.route("/get_result/<task_id>", methods=["GET"])
def get_result(task_id):
    """Polling endpoint to get processing result."""
    if task_id not in TASKS:
        return jsonify({"error": "Invalid task ID"}), 404

    task = TASKS[task_id]
    if task["status"] == "processing":
        return jsonify({"status": "processing"}), 202
    elif task["status"] == "error":
        return jsonify({"error": task["message"]}), 422 if "No faces" in task["message"] else 500
    elif task["status"] == "completed":
        return send_file(task["output_path"], mimetype="image/png")

if __name__ == "__main__":
    app.run(debug=True)
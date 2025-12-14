import os
import json
import numpy as np
import math
import trimesh


def generate_cube(origin=(0, 0, 0), size=1.0):
    x, y, z = origin
    s = size

    vertices = np.array(
        [
            [x, y, z],
            [x + s, y, z],
            [x + s, y + s, z],
            [x, y + s, z],
            [x, y, z + s],
            [x + s, y, z + s],
            [x + s, y + s, z + s],
            [x, y + s, z + s],
        ]
    )

    faces = np.array(
        [
            [0, 1, 2],
            [0, 2, 3],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [2, 3, 7],
            [2, 7, 6],
            [1, 2, 6],
            [1, 6, 5],
            [3, 0, 4],
            [3, 4, 7],
        ]
    )

    return vertices, faces


def generate_mesh_by_faces(num_faces, cube_size=1.0, spacing=0.1):
    verts_all = []
    faces_all = []
    idx_offset = 0

    num_cubes = math.ceil(num_faces / 12)
    n = math.ceil(num_cubes ** (1 / 3))

    count = 0
    for i in range(n):
        for j in range(n):
            for k in range(n):
                if count >= num_cubes:
                    break
                origin = (
                    i * (cube_size + spacing),
                    j * (cube_size + spacing),
                    k * (cube_size + spacing),
                )
                v, f = generate_cube(origin, size=cube_size)
                f = f + idx_offset
                verts_all.append(v)
                faces_all.append(f)
                idx_offset += len(v)
                count += 1
            if count >= num_cubes:
                break
        if count >= num_cubes:
            break

    vertices = np.vstack(verts_all)
    faces = np.vstack(faces_all)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    return mesh


def batch_generate(config_path="config.json"):
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    model_cfg = config.get("model_generation", {})  
    output_dir = model_cfg.get("output_dir", "htmls/models/")
    faces_list = model_cfg.get("faces_list", [1000, 2000, 5000])

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 从web_page配置中获取模型信息（带编号）
    web_page_cfg = config.get("web_page", {})
    models = web_page_cfg.get("models", [])
    
    if models:
        # 使用编号生成模型
        for model in models:
            model_id = model["id"]
            faces = model.get("faces", 1000)
            mesh = generate_mesh_by_faces(num_faces=faces)
            output_file = os.path.join(output_dir, f"model_{model_id}.glb")
            mesh.export(output_file)
            print(f"导出到: {output_file} (faces={faces})")
    else:
        # 兼容旧配置：使用faces_list生成
        for faces in faces_list:
            mesh = generate_mesh_by_faces(num_faces=faces)
            output_file = os.path.join(output_dir, f"model_{faces}.glb")
            mesh.export(output_file)
            print(f"导出到: {output_file}")
            print(f"实际生成面数: {len(mesh.faces)} 个三角面")


if __name__ == "__main__":
    batch_generate()
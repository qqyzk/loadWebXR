#!/usr/bin/env node

/**
 * 改进的OBJ到GLTF转换器
 * 支持纹理、法线贴图和材质属性，与Virtual-Reality-Museum-master保持一致
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// 设置DOM环境
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.FileReader = dom.window.FileReader;
global.Blob = dom.window.Blob;
global.ImageBitmap = dom.window.ImageBitmap || class ImageBitmap {};
global.createImageBitmap = dom.window.createImageBitmap || (() => Promise.resolve({}));

const THREE = require('three');

// 模型配置 - 基于Virtual-Reality-Museum-master/index.html
const MODEL_CONFIGS = {
    floor: {
        obj: 'models/floor.obj',
        textures: {
            diffuse: 'textures/floor.jpg',
            normal: 'textures/floor_normal.jpg'
        },
        material: {
            metalness: 0.6,
            roughness: 0.4
        }
    },
    hall: {
        obj: 'models/hall.obj', 
        textures: {
            diffuse: 'textures/hall.jpg',
            normal: 'textures/hall_normal.jpg'
        },
        material: {
            metalness: 0.3,
            roughness: 0.7
        }
    }
};

async function createImprovedConverter() {
    try {
        // 动态导入Three.js模块
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        
        return { OBJLoader, GLTFExporter };
    } catch (error) {
        console.error('❌ Three.js模块加载失败:', error);
        throw error;
    }
}

/**
 * 创建纹理从文件数据（同步方式）
 */
async function createTextureFromFile(texturePath) {
    if (!fs.existsSync(texturePath)) {
        console.log(`⚠️ 纹理文件不存在: ${texturePath}`);
        return null;
    }
    
    try {
        const Canvas = require('canvas');
        const { createCanvas, loadImage } = Canvas;
        
        console.log(`📖 读取纹理文件: ${path.basename(texturePath)}`);
        
        // 使用canvas加载图像
        const image = await loadImage(texturePath);
        
        // 创建canvas并绘制图像
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        // 创建THREE.js纹理
        const texture = new THREE.CanvasTexture(canvas);
        
        // 设置纹理属性
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false; // GLTF标准
        
        console.log(`✅ 纹理加载成功: ${path.basename(texturePath)} (${image.width}x${image.height})`);
        return texture;
        
    } catch (error) {
        console.error(`❌ 纹理加载失败: ${texturePath}`, error.message);
        return null;
    }
}

/**
 * 加载OBJ模型并应用纹理
 */
async function loadModelWithTextures(modelName, basePath) {
    const config = MODEL_CONFIGS[modelName];
    if (!config) {
        throw new Error(`未找到模型配置: ${modelName}`);
    }
    
    console.log(`\n🔄 加载模型: ${modelName}`);
    console.log(`📁 基础路径: ${basePath}`);
    
    const { OBJLoader, GLTFExporter } = await createImprovedConverter();
    
    // 1. 加载OBJ模型
    const objPath = path.join(basePath, config.obj);
    console.log(`📦 加载OBJ: ${objPath}`);
    
    const objLoader = new OBJLoader();
    const object = await new Promise((resolve, reject) => {
        if (!fs.existsSync(objPath)) {
            reject(new Error(`OBJ文件不存在: ${objPath}`));
            return;
        }
        
        const objContent = fs.readFileSync(objPath, 'utf8');
        const parsed = objLoader.parse(objContent);
        resolve(parsed);
    });
    
    console.log(`✅ OBJ加载完成，包含 ${object.children.length} 个子对象`);
    
    // 2. 加载纹理
    const textures = {};
    
    if (config.textures.diffuse) {
        const diffusePath = path.join(basePath, config.textures.diffuse);
        textures.diffuse = await createTextureFromFile(diffusePath);
    }
    
    if (config.textures.normal) {
        const normalPath = path.join(basePath, config.textures.normal);
        textures.normal = await createTextureFromFile(normalPath);
    }
    
    // 3. 创建材质
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: config.material.metalness || 0.0,
        roughness: config.material.roughness || 0.5,
        side: THREE.DoubleSide
    });
    
    // 应用纹理
    if (textures.diffuse) {
        material.map = textures.diffuse;
        console.log('✅ 应用漫反射纹理');
    }
    
    if (textures.normal) {
        material.normalMap = textures.normal;
        console.log('✅ 应用法线贴图');
    }
    
    // 4. 应用材质到所有网格
    object.traverse((child) => {
        if (child.isMesh) {
            child.material = material;
            
            // 确保几何体有正确的属性
            if (child.geometry) {
                if (!child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }
                child.geometry.computeBoundingBox();
                child.geometry.computeBoundingSphere();
            }
        }
    });
    
    console.log(`🎨 材质应用完成 (metalness: ${material.metalness}, roughness: ${material.roughness})`);
    
    return { object, material, GLTFExporter };
}

/**
 * 导出GLTF/GLB
 */
async function exportModel(scene, outputPath, binary = false) {
    const { GLTFExporter } = await createImprovedConverter();
    const exporter = new GLTFExporter();
    
    return new Promise((resolve, reject) => {
        const options = {
            binary: binary,
            includeCustomExtensions: true,
            embedImages: true, // 嵌入纹理
            maxTextureSize: 2048
        };
        
        exporter.parse(
            scene,
            (result) => {
                try {
                    const ext = binary ? '.glb' : '.gltf';
                    const finalPath = outputPath.replace(/\.(gltf|glb)$/, ext);
                    
                    if (binary) {
                        fs.writeFileSync(finalPath, Buffer.from(result));
                    } else {
                        fs.writeFileSync(finalPath, JSON.stringify(result, null, 2));
                    }
                    
                    const stats = fs.statSync(finalPath);
                    const format = binary ? 'GLB' : 'GLTF';
                    console.log(`✅ ${format}导出成功: ${finalPath}`);
                    console.log(`📊 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
                    
                    resolve(finalPath);
                } catch (error) {
                    reject(error);
                }
            },
            (error) => reject(error),
            options
        );
    });
}

/**
 * 转换指定模型
 */
async function convertModel(modelName) {
    try {
        console.log('🚀 开始改进的OBJ到GLTF转换...');
        console.log('═'.repeat(60));
        
        const basePath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
        const { object } = await loadModelWithTextures(modelName, basePath);
        
        // 创建场景
        const scene = new THREE.Scene();
        scene.add(object);
        
        // 导出两种格式
        const outputBase = path.join(basePath, 'models', `${modelName}_with_textures`);
        
        console.log('\n📤 导出GLTF格式...');
        const gltfPath = await exportModel(scene, outputBase + '.gltf', false);
        
        console.log('\n📤 导出GLB格式...');
        const glbPath = await exportModel(scene, outputBase + '.glb', true);
        
        console.log('\n🎉 转换完成!');
        console.log(`📁 GLTF: ${gltfPath}`);
        console.log(`📁 GLB: ${glbPath}`);
        
        return {
            success: true,
            gltfPath,
            glbPath,
            modelName
        };
        
    } catch (error) {
        console.error('❌ 转换失败:', error.message);
        return {
            success: false,
            error: error.message,
            modelName
        };
    }
}

// 命令行接口
async function main() {
    const args = process.argv.slice(2);
    const modelName = args[0] || 'floor';
    
    if (!MODEL_CONFIGS[modelName]) {
        console.error(`❌ 不支持的模型: ${modelName}`);
        console.log('支持的模型:', Object.keys(MODEL_CONFIGS).join(', '));
        process.exit(1);
    }
    
    const result = await convertModel(modelName);
    process.exit(result.success ? 0 : 1);
}

// 导出模块
module.exports = {
    convertModel,
    MODEL_CONFIGS,
    loadModelWithTextures,
    exportModel
};

// 如果直接运行此文件
if (require.main === module) {
    main();
}

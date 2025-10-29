#!/usr/bin/env node

/**
 * 真实的CTM到GLB转换器
 * 使用Virtual-Reality-Museum项目中的CTM库来正确解析CTM文件
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

// 引入项目中的LZMA库和CTM库
const LZMA_LIB_PATH = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/js/lzma.js');
const CTM_LIB_PATH = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/js/ctm.js');

// 先加载LZMA库 (CTM可能依赖它)
global.LZMA = require(LZMA_LIB_PATH);
const CTM = require(CTM_LIB_PATH);

console.log('✅ LZMA库加载成功:', typeof global.LZMA);
console.log('✅ CTM库加载成功:', typeof CTM);

/**
 * 加载纹理（复用之前的方法）
 */
async function loadTexture(texturePath) {
    if (!fs.existsSync(texturePath)) {
        console.log(`⚠️ 纹理文件不存在: ${path.basename(texturePath)}`);
        return null;
    }
    
    try {
        const Canvas = require('canvas');
        const { createCanvas, loadImage } = Canvas;
        
        console.log(`📖 加载纹理: ${path.basename(texturePath)}`);
        
        const image = await loadImage(texturePath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        const texture = new THREE.CanvasTexture(canvas);
        // 完全匹配THREE.TextureLoader的默认设置
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.flipY = true;
        
        // 关键：设置颜色空间与TextureLoader一致
        texture.colorSpace = THREE.SRGBColorSpace;  // TextureLoader的默认值
        
        console.log(`✅ 纹理加载成功: ${path.basename(texturePath)} (${image.width}x${image.height})`);
        return texture;
        
    } catch (error) {
        console.error(`❌ 纹理加载失败: ${path.basename(texturePath)}`, error.message);
        return null;
    }
}

/**
 * 使用CTM库解析CTM文件
 */
function parseCTMFile(ctmPath) {
    console.log(`📦 解析CTM文件: ${path.basename(ctmPath)}`);
    
    try {
        // 读取CTM文件
        const ctmBuffer = fs.readFileSync(ctmPath);
        
        // 创建Uint8Array (CTM.Stream需要有subarray方法的对象)
        const uint8Array = new Uint8Array(ctmBuffer.buffer, ctmBuffer.byteOffset, ctmBuffer.byteLength);
        
        console.log(`📊 CTM文件大小: ${uint8Array.byteLength} bytes`);
        
        // 创建CTM.Stream
        const stream = new CTM.Stream(uint8Array);
        
        // 解析CTM文件
        const file = new CTM.File(stream);
        
        console.log('✅ CTM解析成功');
        console.log(`📊 顶点数量: ${file.header.vertexCount}`);
        console.log(`📊 三角形数量: ${file.header.triangleCount}`);
        console.log(`📊 压缩方法: ${file.header.method}`);
        
        // 转换为Three.js BufferGeometry
        const geometry = new THREE.BufferGeometry();
        
        // 设置顶点位置
        if (file.body.vertices) {
            const vertices = new Float32Array(file.body.vertices);
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            console.log('✅ 顶点位置设置完成');
        }
        
        // 设置索引
        if (file.body.indices) {
            const indices = new Uint32Array(file.body.indices);
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            console.log('✅ 索引设置完成');
        }
        
        // 设置法线
        if (file.body.normals) {
            const normals = new Float32Array(file.body.normals);
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            console.log('✅ 法线设置完成');
        } else {
            geometry.computeVertexNormals();
            console.log('✅ 自动计算法线完成');
        }
        
        // 设置UV坐标
        if (file.body.uvMaps && file.body.uvMaps.length > 0) {
            const uvs = new Float32Array(file.body.uvMaps[0].uv);
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            console.log('✅ UV坐标设置完成');
        }
        
        // 计算包围盒
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        return geometry;
        
    } catch (error) {
        console.error(`❌ CTM解析失败: ${error.message}`);
        console.error('详细错误:', error);
        throw error;
    }
}

/**
 * 转换单个CTM模型为GLB
 */
async function convertSingleCTM(modelName) {
    console.log(`\n🔄 转换CTM模型: ${modelName}`);
    console.log('═'.repeat(60));
    
    try {
        // 初始化GLTFExporter
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        const exporter = new GLTFExporter();
        
        const basePath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
        
        // 路径设置
        const ctmPath = path.join(basePath, `models/${modelName}.ctm`);
        const texturePath = path.join(basePath, `textures/${modelName}.jpg`);
        
        console.log(`📁 CTM文件: ${ctmPath}`);
        console.log(`📁 纹理文件: ${texturePath}`);
        
        // 1. 解析CTM几何体
        const geometry = parseCTMFile(ctmPath);
        
        // 2. 加载纹理
        const texture = await loadTexture(texturePath);
        
        // 3. 创建材质 (完全复制CTM组件的MeshPhongMaterial设置)
        const material = new THREE.MeshPhongMaterial({
            color: 0xFFFFFF,  // 与ctm_component完全一致
            side: THREE.FrontSide  // 默认值，与ctm_component一致
        });
        
        if (texture) {
            material.map = texture;
            console.log('✅ 纹理应用到材质');
        }
        
        // 4. 创建网格
        const mesh = new THREE.Mesh(geometry, material);
        
        // 5. 创建场景并导出
        const scene = new THREE.Scene();
        scene.add(mesh);
        
        console.log('📤 开始GLB导出...');
        
        const glbData = await new Promise((resolve, reject) => {
            exporter.parse(
                scene,
                (result) => resolve(result),
                (error) => reject(error),
                {
                    binary: true,
                    includeCustomExtensions: true,
                    embedImages: true,
                    maxTextureSize: 2048
                }
            );
        });
        
        // 6. 保存GLB文件
        const outputPath = path.join(basePath, 'models', `${modelName}_real.glb`);
        fs.writeFileSync(outputPath, Buffer.from(glbData));
        
        const stats = fs.statSync(outputPath);
        console.log(`✅ GLB导出成功: ${outputPath}`);
        console.log(`📊 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        
        return {
            success: true,
            modelName,
            outputPath,
            fileSize: stats.size,
            vertexCount: geometry.attributes.position.count,
            triangleCount: geometry.index ? geometry.index.count / 3 : 0
        };
        
    } catch (error) {
        console.error(`❌ 转换失败: ${modelName}`, error.message);
        return {
            success: false,
            modelName,
            error: error.message
        };
    }
}

/**
 * 主函数 - 先测试一个模型
 */
async function main() {
    const testModel = process.argv[2] || 'david'; // 默认测试david模型
    
    console.log('🚀 真实CTM到GLB转换器 - 测试版');
    console.log('═'.repeat(60));
    console.log(`🎯 测试模型: ${testModel}`);
    
    const result = await convertSingleCTM(testModel);
    
    if (result.success) {
        console.log(`\n🎉 ${testModel} 转换成功!`);
        console.log(`📊 几何数据: ${result.vertexCount} 顶点, ${result.triangleCount} 三角形`);
        console.log(`📁 输出文件: ${result.outputPath}`);
        console.log('\n📝 下一步:');
        console.log('  1. 在test-gltf.html中对比原始CTM和转换后的GLB');
        console.log('  2. 确认视觉效果完全一致');
        console.log('  3. 批量转换其他CTM模型');
    } else {
        console.log(`\n❌ ${testModel} 转换失败: ${result.error}`);
    }
    
    process.exit(result.success ? 0 : 1);
}

// 导出模块
module.exports = {
    convertSingleCTM,
    parseCTMFile,
    loadTexture
};

// 如果直接运行
if (require.main === module) {
    main();
}

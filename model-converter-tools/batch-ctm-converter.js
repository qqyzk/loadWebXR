#!/usr/bin/env node

/**
 * 批量CTM到GLB转换器
 * 转换Virtual-Reality-Museum项目中的所有12个CTM模型
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

global.LZMA = require(LZMA_LIB_PATH);
const CTM = require(CTM_LIB_PATH);

console.log('✅ LZMA库加载成功:', typeof global.LZMA);
console.log('✅ CTM库加载成功:', typeof CTM);

/**
 * 所有需要转换的CTM模型
 */
const CTM_MODELS = [
    'david',
    'female_head', 
    'lion',
    'greek_bust',
    'old_man',
    'nefertiti',
    'fractal_1',
    'fractal_2', 
    'fractal_3',
    'female_helmet',
    'monk_uv',
    'david_bike_hall_3'
];

/**
 * 加载纹理
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
        texture.colorSpace = THREE.SRGBColorSpace;
        
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
        const ctmBuffer = fs.readFileSync(ctmPath);
        const uint8Array = new Uint8Array(ctmBuffer.buffer, ctmBuffer.byteOffset, ctmBuffer.byteLength);
        
        console.log(`📊 CTM文件大小: ${uint8Array.byteLength} bytes`);
        
        const stream = new CTM.Stream(uint8Array);
        const file = new CTM.File(stream);
        
        console.log('✅ CTM解析成功');
        console.log(`📊 顶点数量: ${file.header.vertexCount}`);
        console.log(`📊 三角形数量: ${file.header.triangleCount}`);
        
        // 转换为Three.js BufferGeometry
        const geometry = new THREE.BufferGeometry();
        
        if (file.body.vertices) {
            const vertices = new Float32Array(file.body.vertices);
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            console.log('✅ 顶点位置设置完成');
        }
        
        if (file.body.indices) {
            const indices = new Uint32Array(file.body.indices);
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            console.log('✅ 索引设置完成');
        }
        
        if (file.body.normals) {
            const normals = new Float32Array(file.body.normals);
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            console.log('✅ 法线设置完成');
        } else {
            geometry.computeVertexNormals();
            console.log('✅ 自动计算法线完成');
        }
        
        if (file.body.uvMaps && file.body.uvMaps.length > 0) {
            const uvs = new Float32Array(file.body.uvMaps[0].uv);
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            console.log('✅ UV坐标设置完成');
        }
        
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        return geometry;
        
    } catch (error) {
        console.error(`❌ CTM解析失败: ${error.message}`);
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
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        const exporter = new GLTFExporter();
        
        const basePath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
        const ctmPath = path.join(basePath, `models/${modelName}.ctm`);
        const texturePath = path.join(basePath, `textures/${modelName}.jpg`);
        
        console.log(`📁 CTM文件: ${ctmPath}`);
        console.log(`📁 纹理文件: ${texturePath}`);
        
        // 1. 解析CTM几何体
        const geometry = parseCTMFile(ctmPath);
        
        // 2. 加载纹理
        const texture = await loadTexture(texturePath);
        
        // 3. 创建材质（完全复制CTM组件设置）
        const material = new THREE.MeshPhongMaterial({
            color: 0xFFFFFF,
            side: THREE.FrontSide
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
        const outputPath = path.join(basePath, 'models', `${modelName}.glb`);
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
 * 批量转换所有CTM模型
 */
async function batchConvertModels() {
    console.log('🚀 批量CTM到GLB转换器');
    console.log('═'.repeat(80));
    console.log(`🎯 需要转换的模型: ${CTM_MODELS.length}个`);
    console.log(`📂 模型列表: ${CTM_MODELS.join(', ')}`);
    
    const results = [];
    let successCount = 0;
    let totalInputSize = 0;
    let totalOutputSize = 0;
    
    for (const modelName of CTM_MODELS) {
        const result = await convertSingleCTM(modelName);
        results.push(result);
        
        if (result.success) {
            successCount++;
            totalOutputSize += result.fileSize;
            
            // 计算输入文件大小
            const basePath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
            const ctmPath = path.join(basePath, `models/${modelName}.ctm`);
            const texturePath = path.join(basePath, `textures/${modelName}.jpg`);
            
            if (fs.existsSync(ctmPath)) {
                totalInputSize += fs.statSync(ctmPath).size;
            }
            if (fs.existsSync(texturePath)) {
                totalInputSize += fs.statSync(texturePath).size;
            }
        }
        
        // 添加短暂延迟避免内存压力
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 生成转换报告
    console.log('\n' + '═'.repeat(80));
    console.log('📊 批量转换完成报告');
    console.log('═'.repeat(80));
    console.log(`✅ 成功转换: ${successCount}/${CTM_MODELS.length} 个模型`);
    console.log(`📁 输入总大小: ${(totalInputSize / 1024 / 1024).toFixed(2)} MB (CTM + 纹理)`);
    console.log(`📁 输出总大小: ${(totalOutputSize / 1024 / 1024).toFixed(2)} MB (GLB)`);
    console.log(`📈 压缩效率: ${((1 - totalOutputSize / totalInputSize) * 100).toFixed(1)}%`);
    
    console.log('\n📋 详细结果:');
    results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const size = result.success ? `${(result.fileSize / 1024).toFixed(0)}KB` : 'N/A';
        const num = (index + 1).toString().padStart(2, ' ');
        console.log(`${num}. ${status} ${result.modelName.padEnd(20)} - ${size}`);
        if (!result.success) {
            console.log(`     错误: ${result.error}`);
        }
    });
    
    if (successCount === CTM_MODELS.length) {
        console.log('\n🎉 所有CTM模型转换成功！');
        console.log('📝 下一步:');
        console.log('  1. 更新index.html中的CTM引用为GLB');
        console.log('  2. 测试转换效果');
        console.log('  3. 提交代码更改');
    } else {
        console.log(`\n⚠️ 有 ${CTM_MODELS.length - successCount} 个模型转换失败，请检查错误信息`);
    }
    
    return results;
}

/**
 * 主函数
 */
async function main() {
    try {
        const results = await batchConvertModels();
        const allSuccess = results.every(r => r.success);
        process.exit(allSuccess ? 0 : 1);
    } catch (error) {
        console.error('❌ 批量转换过程中发生错误:', error);
        process.exit(1);
    }
}

// 如果直接运行
if (require.main === module) {
    main();
}

module.exports = {
    batchConvertModels,
    convertSingleCTM,
    CTM_MODELS
};

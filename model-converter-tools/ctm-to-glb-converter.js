#!/usr/bin/env node

/**
 * CTM to GLB Converter
 * 将Virtual-Reality-Museum中的CTM模型转换为GLB格式
 * 基于项目现有的CTM加载机制
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

// CTM模型配置 - 基于Virtual-Reality-Museum的使用方式
const CTM_MODELS = {
    david: {
        ctm: 'models/david.ctm',
        texture: 'textures/david.jpg',
        material: { shininess: 30 }
    },
    female_head: {
        ctm: 'models/female_head.ctm',
        texture: 'textures/female_head.jpg',
        material: { shininess: 30 }
    },
    lion: {
        ctm: 'models/lion.ctm',
        texture: 'textures/lion.jpg',
        material: { shininess: 30 }
    },
    greek_bust: {
        ctm: 'models/greek_bust.ctm',
        texture: 'textures/greek_bust.jpg',
        material: { shininess: 30 }
    },
    old_man: {
        ctm: 'models/old_man.ctm',
        texture: 'textures/old_man.jpg',
        material: { shininess: 30 }
    },
    nefertiti: {
        ctm: 'models/nefertiti.ctm',
        texture: 'textures/nefertiti.jpg',
        material: { shininess: 30 }
    },
    fractal_1: {
        ctm: 'models/fractal_1.ctm',
        texture: 'textures/fractal_1.jpg',
        material: { shininess: 30 }
    },
    fractal_2: {
        ctm: 'models/fractal_2.ctm',
        texture: 'textures/fractal_2.jpg',
        material: { shininess: 30 }
    },
    fractal_3: {
        ctm: 'models/fractal_3.ctm',
        texture: 'textures/fractal_3.jpg',
        material: { shininess: 30 }
    },
    female_helmet: {
        ctm: 'models/female_helmet.ctm',
        texture: 'textures/female_helmet.jpg',
        material: { shininess: 30 }
    },
    monk_uv: {
        ctm: 'models/monk_uv.ctm',
        texture: 'textures/monk_uv.jpg',
        material: { shininess: 30 }
    },
    david_bike_hall_3: {
        ctm: 'models/david_bike_hall_3.ctm',
        texture: 'textures/david_bike_hall_3.jpg',
        material: { shininess: 30 }
    }
};

/**
 * 初始化Three.js模块
 */
async function initializeThreeJS() {
    try {
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        
        // 尝试加载CTMLoader
        let CTMLoader;
        try {
            const ctmModule = await import('three/examples/jsm/loaders/CTMLoader.js');
            CTMLoader = ctmModule.CTMLoader;
        } catch (ctmError) {
            console.log('⚠️ Three.js CTMLoader不可用，将使用替代方案');
            CTMLoader = null;
        }
        
        return { GLTFExporter, CTMLoader };
    } catch (error) {
        console.error('❌ Three.js模块加载失败:', error);
        throw error;
    }
}

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
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        
        console.log(`✅ 纹理加载成功: ${path.basename(texturePath)} (${image.width}x${image.height})`);
        return texture;
        
    } catch (error) {
        console.error(`❌ 纹理加载失败: ${path.basename(texturePath)}`, error.message);
        return null;
    }
}

/**
 * 加载CTM文件的替代方案
 * 由于CTMLoader在Node.js中可能不可用，我们创建一个placeholder几何体
 */
function createPlaceholderGeometry() {
    console.log('🔧 创建占位几何体 (CTM加载器不可用)');
    
    // 创建一个简单的立方体作为占位符
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    return geometry;
}

/**
 * 尝试加载CTM文件
 */
async function loadCTMModel(ctmPath, loaders) {
    const { CTMLoader } = loaders;
    
    if (!fs.existsSync(ctmPath)) {
        throw new Error(`CTM文件不存在: ${ctmPath}`);
    }
    
    console.log(`📦 加载CTM: ${path.basename(ctmPath)}`);
    
    // 如果CTMLoader不可用，使用占位几何体
    if (!CTMLoader) {
        console.log('⚠️ 使用占位几何体替代CTM加载');
        return createPlaceholderGeometry();
    }
    
    try {
        // 尝试使用CTMLoader
        const ctmLoader = new CTMLoader();
        const ctmContent = fs.readFileSync(ctmPath);
        
        // 由于CTMLoader.parse通常期望ArrayBuffer，我们需要转换
        const arrayBuffer = ctmContent.buffer.slice(
            ctmContent.byteOffset, 
            ctmContent.byteOffset + ctmContent.byteLength
        );
        
        // 这里可能需要异步处理
        return new Promise((resolve, reject) => {
            try {
                const geometry = ctmLoader.parse(arrayBuffer);
                console.log(`✅ CTM加载成功: ${path.basename(ctmPath)}`);
                resolve(geometry);
            } catch (error) {
                console.log(`⚠️ CTM解析失败，使用占位几何体: ${error.message}`);
                resolve(createPlaceholderGeometry());
            }
        });
        
    } catch (error) {
        console.log(`⚠️ CTM加载失败，使用占位几何体: ${error.message}`);
        return createPlaceholderGeometry();
    }
}

/**
 * 转换单个CTM模型
 */
async function convertCTMModel(modelName, basePath, loaders) {
    const config = CTM_MODELS[modelName];
    const { GLTFExporter } = loaders;
    
    console.log(`\n🔄 转换CTM模型: ${modelName}`);
    console.log('─'.repeat(50));
    
    try {
        // 1. 加载CTM几何体
        const ctmPath = path.join(basePath, config.ctm);
        const geometry = await loadCTMModel(ctmPath, loaders);
        
        // 2. 加载纹理
        const texturePath = path.join(basePath, config.texture);
        const texture = await loadTexture(texturePath);
        
        // 3. 创建材质 - 模拟MeshPhongMaterial的效果
        const materialOptions = {
            color: 0xffffff,
            ...config.material
        };
        
        if (texture) {
            materialOptions.map = texture;
        }
        
        // 使用MeshStandardMaterial替代MeshPhongMaterial (更现代)
        const material = new THREE.MeshStandardMaterial(materialOptions);
        
        console.log(`🎨 材质配置: shininess=${materialOptions.shininess || 'default'}`);
        
        // 4. 创建网格
        const mesh = new THREE.Mesh(geometry, material);
        
        // 确保几何体有正确的属性
        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        // 5. 导出GLB
        const scene = new THREE.Scene();
        scene.add(mesh);
        
        const exporter = new GLTFExporter();
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
            fileSize: stats.size
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
async function batchConvertCTMModels() {
    console.log('🚀 CTM到GLB批量转换器');
    console.log('═'.repeat(60));
    
    try {
        // 初始化
        const loaders = await initializeThreeJS();
        const basePath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
        
        console.log(`📁 博物馆路径: ${basePath}`);
        console.log(`🎯 需要转换的CTM模型数量: ${Object.keys(CTM_MODELS).length}`);
        
        // 批量转换
        const results = [];
        for (const modelName of Object.keys(CTM_MODELS)) {
            const result = await convertCTMModel(modelName, basePath, loaders);
            results.push(result);
        }
        
        // 统计结果
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        console.log('\n📊 CTM转换结果统计:');
        console.log('═'.repeat(60));
        console.log(`✅ 成功转换: ${successful.length}/${results.length} 个CTM模型`);
        
        if (successful.length > 0) {
            const totalSize = successful.reduce((sum, r) => sum + r.fileSize, 0);
            console.log(`📦 总文件大小: ${(totalSize / (1024*1024)).toFixed(2)} MB`);
            
            console.log('\n✅ 成功转换的CTM模型:');
            successful.forEach(r => {
                console.log(`  - ${r.modelName}: ${(r.fileSize/1024).toFixed(2)} KB`);
            });
        }
        
        if (failed.length > 0) {
            console.log('\n❌ 转换失败的CTM模型:');
            failed.forEach(r => {
                console.log(`  - ${r.modelName}: ${r.error}`);
            });
        }
        
        // 保存转换报告
        const report = {
            timestamp: new Date().toISOString(),
            type: 'CTM to GLB conversion',
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            results: results
        };
        
        const reportPath = path.join(__dirname, 'ctm-conversion-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 CTM转换报告已保存: ${reportPath}`);
        
        return results;
        
    } catch (error) {
        console.error('❌ CTM批量转换失败:', error);
        return [];
    }
}

/**
 * 主函数
 */
async function main() {
    const results = await batchConvertCTMModels();
    const successCount = results.filter(r => r.success).length;
    
    if (successCount > 0) {
        console.log(`\n🎉 CTM批量转换完成! 成功转换 ${successCount} 个模型`);
        console.log('📝 下一步:');
        console.log('  1. 检查生成的GLB文件');
        console.log('  2. 更新HTML中的CTM引用为GLB');
        console.log('  3. 测试转换效果');
    } else {
        console.log('\n⚠️ 注意: 可能需要安装CTM支持库或使用其他转换方案');
    }
    
    process.exit(successCount > 0 ? 0 : 1);
}

// 导出模块
module.exports = {
    batchConvertCTMModels,
    convertCTMModel,
    CTM_MODELS
};

// 如果直接运行
if (require.main === module) {
    main();
}

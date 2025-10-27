#!/usr/bin/env node

/**
 * 测试Floor模型转换
 * 专门用于测试floor.obj模型的转换功能
 */

const path = require('path');
const { ObjToGltfConverter, initializeThreeJS } = require('./obj-to-gltf-converter.js');

async function testFloorConversion() {
    console.log('🧪 开始Floor模型转换测试\n');
    
    try {
        // 初始化Three.js
        console.log('⚙️ 初始化Three.js...');
        await initializeThreeJS();
        
        // 设置路径
        const museumPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
        const modelsPath = path.join(museumPath, 'models');
        const texturesPath = path.join(museumPath, 'textures');
        
        const floorObjPath = path.join(modelsPath, 'floor.obj');
        const floorMtlPath = path.join(modelsPath, 'floor.mtl');
        
        console.log(`📁 Museum路径: ${museumPath}`);
        console.log(`📁 Models路径: ${modelsPath}`);
        console.log(`📁 Textures路径: ${texturesPath}`);
        console.log(`📁 Floor OBJ: ${floorObjPath}`);
        console.log(`📁 Floor MTL: ${floorMtlPath}\n`);
        
        // 创建转换器实例 - 测试两种格式
        const formats = ['gltf', 'glb'];
        const results = [];
        
        for (const format of formats) {
            console.log(`🔄 测试 ${format.toUpperCase()} 格式转换:`);
            console.log('─'.repeat(50));
            
            const converter = new ObjToGltfConverter({
                outputFormat: format,
                binary: format === 'glb',
                includeTextures: true,
                optimizeGeometry: true,
                verbose: true
            });
            
            converter.initialize();
            
            // 执行转换
            const result = await converter.convertModel(floorObjPath, {
                mtlPath: floorMtlPath,
                texturePath: texturesPath + '/',
                outputPath: path.join(modelsPath, `floor_converted.${format}`)
            });
            
            results.push(result);
            
            if (result.success) {
                console.log(`✅ ${format.toUpperCase()} 转换成功`);
            } else {
                console.log(`❌ ${format.toUpperCase()} 转换失败: ${result.error}`);
            }
            console.log('');
        }
        
        // 输出测试结果摘要
        console.log('📊 测试结果摘要:');
        console.log('═'.repeat(50));
        
        let successCount = 0;
        results.forEach((result, index) => {
            const format = formats[index].toUpperCase();
            if (result.success) {
                console.log(`✅ ${format}: 成功 - ${result.outputPath}`);
                successCount++;
            } else {
                console.log(`❌ ${format}: 失败 - ${result.error}`);
            }
        });
        
        console.log(`\n🎯 总计: ${successCount}/${results.length} 个格式转换成功`);
        
        if (successCount > 0) {
            console.log('\n📝 下一步:');
            console.log('  1. 检查生成的GLTF/GLB文件');
            console.log('  2. 在test-gltf.html中测试显示效果');
            console.log('  3. 对比原始OBJ和转换后的GLTF模型');
        }
        
        return results;
        
    } catch (error) {
        console.error('❌ 测试执行失败:', error.message);
        console.error(error.stack);
        return null;
    }
}

// 如果直接运行此文件
if (require.main === module) {
    testFloorConversion().then(results => {
        if (results && results.some(r => r.success)) {
            process.exit(0);
        } else {
            process.exit(1);
        }
    });
}

module.exports = { testFloorConversion };

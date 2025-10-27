#!/usr/bin/env node

/**
 * Virtual Reality Museum HTML更新器
 * 自动将index.html中的OBJ模型引用替换为GLB格式
 */

const fs = require('fs');
const path = require('path');

// 需要替换的模型列表
const MODEL_REPLACEMENTS = [
    'floor',
    'hall', 
    'hall_low_floor',
    'acropolis',
    'castle_lake',
    'good_samaritan',
    'moonlight',
    'podiums',
    'lamps'
];

/**
 * 更新HTML文件
 */
function updateMuseumHTML() {
    console.log('🔧 Virtual Reality Museum HTML更新器');
    console.log('═'.repeat(50));
    
    const htmlPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/index.html');
    const backupPath = htmlPath + '.backup';
    
    try {
        // 1. 读取HTML文件
        console.log(`📖 读取HTML文件: ${htmlPath}`);
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');
        
        // 2. 创建备份
        fs.writeFileSync(backupPath, htmlContent);
        console.log(`💾 创建备份文件: ${backupPath}`);
        
        let changeCount = 0;
        
        // 3. 替换所有模型引用
        for (const modelName of MODEL_REPLACEMENTS) {
            console.log(`\n🔄 处理模型: ${modelName}`);
            
            // 替换asset定义：从OBJ到GLB
            const assetObjPattern = new RegExp(
                `<a-asset-item id="${modelName}-obj" src="models/${modelName}\\.obj"></a-asset-item>`,
                'g'
            );
            const assetGlbReplacement = `<a-asset-item id="${modelName}-glb" src="models/${modelName}.glb"></a-asset-item>`;
            
            if (assetObjPattern.test(htmlContent)) {
                htmlContent = htmlContent.replace(assetObjPattern, assetGlbReplacement);
                console.log(`  ✅ Asset定义: ${modelName}-obj → ${modelName}-glb`);
                changeCount++;
            }
            
            // 替换纹理引用（移除，因为GLB已包含纹理）
            const texturePatterns = [
                new RegExp(`\\s*<img id="${modelName}-texture" src="textures/${modelName}\\.jpg">`, 'g'),
                new RegExp(`\\s*<img id="${modelName}_normal-texture" src="textures/${modelName}_normal\\.jpg">`, 'g')
            ];
            
            texturePatterns.forEach((pattern, index) => {
                if (pattern.test(htmlContent)) {
                    htmlContent = htmlContent.replace(pattern, '');
                    const textureType = index === 0 ? 'diffuse' : 'normal';
                    console.log(`  ✅ 移除${textureType}纹理引用`);
                    changeCount++;
                }
            });
            
            // 替换实体引用：从obj-model到gltf-model
            const entityPattern = new RegExp(
                `<a-entity\\s+obj-model="obj: #${modelName}-obj;"\\s+material="[^"]*"([^>]*)></a-entity>`,
                'g'
            );
            
            const entityReplacement = `<a-entity gltf-model="#${modelName}-glb"$1></a-entity>`;
            
            if (entityPattern.test(htmlContent)) {
                htmlContent = htmlContent.replace(entityPattern, entityReplacement);
                console.log(`  ✅ 实体引用: obj-model → gltf-model`);
                changeCount++;
            }
        }
        
        // 4. 写入更新后的HTML
        if (changeCount > 0) {
            fs.writeFileSync(htmlPath, htmlContent);
            console.log(`\n✅ HTML更新完成! 共进行了 ${changeCount} 处更改`);
            console.log(`📁 更新文件: ${htmlPath}`);
            console.log(`💾 备份文件: ${backupPath}`);
        } else {
            console.log('\n⚠️ 没有找到需要更新的引用');
        }
        
        // 5. 验证更新结果
        console.log('\n📊 验证更新结果:');
        const updatedContent = fs.readFileSync(htmlPath, 'utf8');
        
        MODEL_REPLACEMENTS.forEach(modelName => {
            const hasGlbAsset = updatedContent.includes(`id="${modelName}-glb"`);
            const hasGltfModel = updatedContent.includes(`gltf-model="#${modelName}-glb"`);
            const hasObjAsset = updatedContent.includes(`id="${modelName}-obj"`);
            
            console.log(`  ${modelName}: GLB资产=${hasGlbAsset ? '✅' : '❌'}, GLTF模型=${hasGltfModel ? '✅' : '❌'}, 残留OBJ=${hasObjAsset ? '❌' : '✅'}`);
        });
        
        return {
            success: true,
            changes: changeCount,
            backupPath
        };
        
    } catch (error) {
        console.error('❌ HTML更新失败:', error.message);
        
        // 如果出错且备份存在，尝试恢复
        if (fs.existsSync(backupPath)) {
            try {
                fs.copyFileSync(backupPath, htmlPath);
                console.log('🔄 已从备份文件恢复');
            } catch (restoreError) {
                console.error('❌ 备份恢复也失败:', restoreError.message);
            }
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 创建性能对比报告
 */
function generatePerformanceReport() {
    console.log('\n📈 生成性能对比报告...');
    
    const modelsPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/models');
    const texturesPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/textures');
    
    const report = {
        timestamp: new Date().toISOString(),
        comparison: {
            before: { files: 0, totalSize: 0, description: 'OBJ + 分离纹理' },
            after: { files: 0, totalSize: 0, description: 'GLB + 嵌入纹理' }
        },
        models: []
    };
    
    MODEL_REPLACEMENTS.forEach(modelName => {
        const modelInfo = { name: modelName, before: {}, after: {} };
        
        // 统计转换前 (OBJ + 纹理文件)
        const objPath = path.join(modelsPath, `${modelName}.obj`);
        const texturePath = path.join(texturesPath, `${modelName}.jpg`);
        const normalPath = path.join(texturesPath, `${modelName}_normal.jpg`);
        
        let beforeSize = 0;
        let beforeFiles = 0;
        
        if (fs.existsSync(objPath)) {
            const objSize = fs.statSync(objPath).size;
            beforeSize += objSize;
            beforeFiles++;
            modelInfo.before.obj = objSize;
        }
        
        if (fs.existsSync(texturePath)) {
            const textureSize = fs.statSync(texturePath).size;
            beforeSize += textureSize;
            beforeFiles++;
            modelInfo.before.texture = textureSize;
        }
        
        if (fs.existsSync(normalPath)) {
            const normalSize = fs.statSync(normalPath).size;
            beforeSize += normalSize;
            beforeFiles++;
            modelInfo.before.normal = normalSize;
        }
        
        // 统计转换后 (GLB)
        const glbPath = path.join(modelsPath, `${modelName}.glb`);
        let afterSize = 0;
        let afterFiles = 0;
        
        if (fs.existsSync(glbPath)) {
            afterSize = fs.statSync(glbPath).size;
            afterFiles = 1;
            modelInfo.after.glb = afterSize;
        }
        
        modelInfo.before.totalSize = beforeSize;
        modelInfo.before.fileCount = beforeFiles;
        modelInfo.after.totalSize = afterSize;
        modelInfo.after.fileCount = afterFiles;
        modelInfo.compressionRatio = beforeSize > 0 ? (afterSize / beforeSize).toFixed(2) : 'N/A';
        
        report.comparison.before.files += beforeFiles;
        report.comparison.before.totalSize += beforeSize;
        report.comparison.after.files += afterFiles;
        report.comparison.after.totalSize += afterSize;
        
        report.models.push(modelInfo);
        
        console.log(`  ${modelName}: ${beforeFiles}个文件 (${(beforeSize/1024).toFixed(2)}KB) → 1个文件 (${(afterSize/1024).toFixed(2)}KB)`);
    });
    
    // 保存报告
    const reportPath = path.join(__dirname, 'performance-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📊 总体对比:`);
    console.log(`  转换前: ${report.comparison.before.files}个文件, ${(report.comparison.before.totalSize/(1024*1024)).toFixed(2)}MB`);
    console.log(`  转换后: ${report.comparison.after.files}个文件, ${(report.comparison.after.totalSize/(1024*1024)).toFixed(2)}MB`);
    console.log(`  文件减少: ${((report.comparison.before.files - report.comparison.after.files) / report.comparison.before.files * 100).toFixed(1)}%`);
    console.log(`📄 详细报告: ${reportPath}`);
}

/**
 * 主函数
 */
function main() {
    const result = updateMuseumHTML();
    
    if (result.success) {
        generatePerformanceReport();
        
        console.log('\n🎉 更新完成!');
        console.log('📝 下一步:');
        console.log('  1. 在浏览器中打开 index.html 测试效果');
        console.log('  2. 检查所有模型是否正确加载');
        console.log('  3. 对比加载性能和视觉效果');
        console.log(`  4. 如有问题，可从 ${result.backupPath} 恢复`);
    }
    
    process.exit(result.success ? 0 : 1);
}

// 如果直接运行
if (require.main === module) {
    main();
}

module.exports = {
    updateMuseumHTML,
    generatePerformanceReport,
    MODEL_REPLACEMENTS
};

# Museum Model Converter Tools

这个工具集用于将Virtual Reality Museum应用中的OBJ模型转换为GLTF格式，以适配WebXR项目。

## 文件说明

### 转换工具
- `museum-converter.html` - 主要的转换工具，用于批量转换museum中的OBJ模型
- `obj-to-gltf-converter.html` - 通用的OBJ到GLTF转换工具
- `test-model-comparison.html` - 用于测试和对比转换前后的模型

### 测试文件
- `test-gltf.html` - 在A-Frame中测试OBJ和GLTF模型的对比显示

## 使用方法

### 1. 使用Museum Converter转换模型

1. 打开 `museum-converter.html` 文件
2. 点击 "Convert All Models" 按钮开始批量转换
3. 等待转换完成
4. 点击 "Download All GLTF" 下载所有转换后的GLTF文件
5. 将下载的GLTF文件放到 `../realCase/Virtual-Reality-Museum-master/models/` 目录中

### 2. 测试转换结果

1. 打开 `test-gltf.html` 文件
2. 查看OBJ模型（左侧）和GLTF模型（右侧）的对比
3. 验证转换是否正确

### 3. 更新Museum应用

转换完成后，需要更新 `index.html` 文件，将OBJ模型引用替换为GLTF模型引用：

```html
<!-- 原来的OBJ模型 -->
<a-entity obj-model="obj: #floor-obj;" material="src: #floor-texture;" id="floor"></a-entity>

<!-- 替换为GLTF模型 -->
<a-entity gltf-model="#floor-gltf" id="floor"></a-entity>
```

## 支持的模型

当前支持转换的模型：
- floor (地板)
- hall (大厅)
- acropolis (卫城)
- castle_lake (城堡湖)
- good_samaritan (好撒玛利亚人)
- moonlight (月光)
- podiums (讲台)
- lamps (灯具)

## 注意事项

1. 确保模型文件路径正确
2. 转换过程中需要网络连接（加载Three.js库）
3. 转换后的GLTF文件会包含纹理信息
4. 建议在转换前备份原始模型文件

## 故障排除

如果转换失败：
1. 检查模型文件是否存在
2. 检查网络连接
3. 查看浏览器控制台的错误信息
4. 确保模型文件格式正确

## 技术细节

- 使用Three.js的OBJLoader和MTLLoader加载原始模型
- 使用GLTFExporter导出为GLTF格式
- 支持材质和纹理的转换
- 保持模型的几何结构和UV映射

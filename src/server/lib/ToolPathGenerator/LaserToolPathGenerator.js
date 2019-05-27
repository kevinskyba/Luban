import Jimp from 'jimp';
import EventEmitter from 'events';
import SVGParser, { flip, rotate, scale, sortShapes, translate } from '../SVGParser';
import GcodeParser from './GcodeParser';
import Normalizer from './Normalizer';
import { svgToSegments } from './SVGFill';

// function cross(p0, p1, p2) {
//     return (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
// }

function pointEqual(p1, p2) {
    return p1[0] === p2[0] && p1[1] === p2[1];
}

class LaserToolPathGenerator extends EventEmitter {
    getGcodeHeader() {
        const date = new Date();
        return [
            '; G-code for laser engraving',
            '; Generated by Snapmakerjs',
            `; ${date.toDateString()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`
        ].join('\n') + '\n\n';
    }

    async generateToolPathObj(modelInfo, modelPath) {
        const { mode } = modelInfo;
        const { movementMode } = modelInfo.config;

        let fakeGcode = this.getGcodeHeader();

        fakeGcode += 'G90\n'; // absolute position
        fakeGcode += 'G21\n'; // millimeter units

        let workingGcode = '';
        if (mode === 'bw' || (mode === 'greyscale' && movementMode === 'greyscale-line')) {
            workingGcode = await this.generateGcodeBW(modelInfo, modelPath);
        } else if (mode === 'greyscale') {
            workingGcode = await this.generateGcodeGreyscale(modelInfo, modelPath);
        } else if (mode === 'vector' || mode === 'trace') {
            workingGcode = await this.generateGcodeVector(modelInfo, modelPath);
        } else {
            return Promise.reject(new Error('Unsupported process mode: ' + mode));
        }

        fakeGcode += '; G-code START <<<\n';
        fakeGcode += workingGcode + '\n';
        fakeGcode += '; G-code END <<<\n';

        const toolPathObject = new GcodeParser().parseGcodeToToolPathObj(fakeGcode, modelInfo);
        return toolPathObject;
    }

    async generateGcodeGreyscale(modelInfo, modelPath) {
        const { gcodeConfigPlaceholder, config } = modelInfo;
        const { workSpeed, dwellTime } = gcodeConfigPlaceholder;
        const { bwThreshold } = config;

        const img = await Jimp.read(modelPath);
        img.mirror(false, true);

        const width = img.bitmap.width;
        const height = img.bitmap.height;

        const normalizer = new Normalizer('Center', 0, width, 0, height, {
            x: 1 / config.density,
            y: 1 / config.density
        });

        let progress = 0;
        let content = '';
        content += `G1 F${workSpeed}\n`;

        for (let i = 0; i < width; ++i) {
            const isReverse = (i % 2 === 0);
            for (let j = (isReverse ? height : 0); isReverse ? j >= 0 : j < height; isReverse ? j-- : j++) {
                const idx = j * width * 4 + i * 4;
                if (img.bitmap.data[idx] < bwThreshold) {
                    content += `G1 X${normalizer.x(i)} Y${normalizer.y(j)}\n`;
                    content += 'M03\n';
                    content += `G4 P${dwellTime}\n`;
                    content += 'M05\n';
                }
            }
            const p = i / width;
            if (p - progress > 0.05) {
                progress = p;
                this.emit('progress', progress);
            }
        }
        content += 'G0 X0 Y0';

        return content;
    }

    async generateGcodeBW(modelInfo, modelPath) {
        const { gcodeConfigPlaceholder, config } = modelInfo;
        const { workSpeed, jogSpeed } = gcodeConfigPlaceholder;
        const { bwThreshold } = config;

        function extractSegment(data, start, box, direction, sign) {
            let len = 1;

            function idx(pos) {
                return pos.x * 4 + pos.y * box.width * 4;
            }

            for (; ;) {
                const cur = {
                    x: start.x + direction.x * len * sign,
                    y: start.y + direction.y * len * sign
                };
                if (!bitEqual(data[idx(cur)], data[idx(start)]) ||
                    cur.x < 0 || cur.x >= box.width ||
                    cur.y < 0 || cur.y >= box.height) {
                    break;
                }
                len += 1;
            }
            return len;
        }

        function genMovement(normalizer, start, end) {
            return [
                `G0 X${normalizer.x(start.x)} Y${normalizer.y(start.y)}`,
                'M3',
                `G1 X${normalizer.x(end.x)} Y${normalizer.y(end.y)}`,
                'M5'
            ].join('\n') + '\n';
        }

        function bitEqual(a, b) {
            return (a <= bwThreshold && b <= bwThreshold) || (a > bwThreshold && b > bwThreshold);
        }

        const img = await Jimp.read(modelPath);
        img.mirror(false, true);

        const width = img.bitmap.width;
        const height = img.bitmap.height;

        const normalizer = new Normalizer('Center', 0, width, 0, height, {
            x: 1 / config.density,
            y: 1 / config.density
        });

        let progress = 0;
        let content = '';
        content += `G0 F${jogSpeed}\n`;
        content += `G1 F${workSpeed}\n`;

        if (!config.direction || config.direction === 'Horizontal') {
            const direction = { x: 1, y: 0 };
            for (let j = 0; j < height; j++) {
                let len = 0;
                const isReverse = (j % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                for (let i = (isReverse ? width - 1 : 0); isReverse ? i >= 0 : i < width; i += len * sign) {
                    const idx = i * 4 + j * width * 4;
                    if (img.bitmap.data[idx] <= bwThreshold) {
                        const start = {
                            x: i,
                            y: j
                        };
                        len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                        const end = {
                            x: start.x + direction.x * len * sign,
                            y: start.y + direction.y * len * sign
                        };
                        content += genMovement(normalizer, start, end);
                    } else {
                        len = 1;
                    }
                }
                const p = j / height;
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        } else if (config.direction === 'Vertical') {
            let direction = { x: 0, y: 1 };
            for (let i = 0; i < width; ++i) {
                let len = 0;
                const isReverse = (i % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                for (let j = (isReverse ? height - 1 : 0); isReverse ? j >= 0 : j < height; j += len * sign) {
                    const idx = i * 4 + j * width * 4;
                    if (img.bitmap.data[idx] <= bwThreshold) {
                        const start = {
                            x: i,
                            y: j
                        };
                        len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                        const end = {
                            x: start.x + direction.x * len * sign,
                            y: start.y + direction.y * len * sign
                        };
                        content += genMovement(normalizer, start, end);
                    } else {
                        len = 1;
                    }
                }
                const p = i / width;
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        } else if (config.direction === 'Diagonal') {
            const direction = { x: 1, y: -1 };
            for (let k = 0; k < width + height - 1; k++) {
                let len = 0;
                const isReverse = (k % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                for (let i = (isReverse ? width - 1 : 0); isReverse ? i >= 0 : i < width; i += len * sign) {
                    const j = k - i;
                    if (j < 0 || j > height) {
                        len = 1; // FIXME: optimize
                    } else {
                        const idx = i * 4 + j * width * 4;
                        if (img.bitmap.data[idx] <= bwThreshold) {
                            const start = {
                                x: i,
                                y: j
                            };
                            len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                            const end = {
                                x: start.x + direction.x * len * sign,
                                y: start.y + direction.y * len * sign
                            };
                            content += genMovement(normalizer, start, end);
                        } else {
                            len = 1;
                        }
                    }
                }
                const p = k / (width + height);
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        } else if (config.direction === 'Diagonal2') {
            const direction = { x: 1, y: 1 };
            for (let k = -height; k <= width; k++) {
                const isReverse = (k % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                let len = 0;
                for (let i = (isReverse ? width - 1 : 0); isReverse ? i >= 0 : i < width; i += len * sign) {
                    const j = i - k;
                    if (j < 0 || j > height) {
                        len = 1;
                    } else {
                        const idx = i * 4 + j * width * 4;
                        if (img.bitmap.data[idx] <= bwThreshold) {
                            let start = {
                                x: i,
                                y: j
                            };
                            len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                            const end = {
                                x: start.x + direction.x * len * sign,
                                y: start.y + direction.y * len * sign
                            };
                            content += genMovement(normalizer, start, end);
                        } else {
                            len = 1;
                        }
                    }
                }
                const p = k / (width + height);
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        }
        content += 'G0 X0 Y0\n';

        return content;
    }

    async generateGcodeVector(modelInfo, modelPath) {
        const { gcodeConfigPlaceholder } = modelInfo;
        const { workSpeed, jogSpeed } = gcodeConfigPlaceholder;
        const originWidth = modelInfo.source.width;
        const originHeight = modelInfo.source.height;

        const targetWidth = modelInfo.transformation.width;
        const targetHeight = modelInfo.transformation.height;

        // rotation: degree and counter-clockwise
        const rotation = modelInfo.transformation.rotation;
        const flipFlag = modelInfo.transformation.flip;

        const { fillEnabled, fillDensity, optimizePath } = modelInfo.config;

        const svgParser = new SVGParser();

        const svg = await svgParser.parseFile(modelPath);
        flip(svg, 1);
        flip(svg, flipFlag);
        scale(svg, {
            x: targetWidth / originWidth,
            y: targetHeight / originHeight
        });
        if (optimizePath) {
            sortShapes(svg);
        }
        rotate(svg, rotation); // rotate: unit is radians and counter-clockwise
        translate(svg, -svg.viewBox[0], -svg.viewBox[1]);

        const normalizer = new Normalizer(
            'Center',
            svg.viewBox[0],
            svg.viewBox[0] + svg.viewBox[2],
            svg.viewBox[1],
            svg.viewBox[1] + svg.viewBox[3],
            { x: 1, y: 1 }
        );

        const segments = svgToSegments(svg, {
            width: svg.viewBox[2],
            height: svg.viewBox[3],
            fillEnabled: fillEnabled,
            fillDensity: fillDensity
        });

        // second pass generate gcode
        let progress = 0;
        let content = '';
        content += `G0 F${jogSpeed}\n`;
        content += `G1 F${workSpeed}\n`;

        let current = null;
        for (const segment of segments) {
            // G0 move to start
            if (!current || current && !(pointEqual(current, segment.start))) {
                if (current) {
                    content += 'M5\n';
                }

                // Move to start point
                content += `G0 X${normalizer.x(segment.start[0])} Y${normalizer.y(segment.start[1])}\n`;
                content += 'M3\n';
            }

            // G0 move to end
            content += `G1 X${normalizer.x(segment.end[0])} Y${normalizer.y(segment.end[1])}\n`;

            current = segment.end;

            progress += 1;
        }
        if (segments.length !== 0) {
            progress /= segments.length;
        }
        this.emit('progress', progress);
        // turn off
        if (current) {
            content += 'M5\n';
        }

        // move to work zero
        content += 'G0 X0 Y0\n';

        return content;
    }
}

export default LaserToolPathGenerator;
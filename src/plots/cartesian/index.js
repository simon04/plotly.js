/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var d3 = require('d3');

var Registry = require('../../registry');
var Lib = require('../../lib');
var Plots = require('../plots');
var Drawing = require('../../components/drawing');
var Color = require('../../components/color');

var getModuleCalcData = require('../get_data').getModuleCalcData;
var xmlnsNamespaces = require('../../constants/xmlns_namespaces');
var FROM_BL = require('../../constants/alignment').FROM_BL;

var Axes = require('./axes');
var axisIds = require('./axis_ids');
var constants = require('./constants');

var ensureSingle = Lib.ensureSingle;

function ensureSingleAndAddDatum(parent, nodeType, className) {
    return Lib.ensureSingle(parent, nodeType, className, function(s) {
        s.datum(className);
    });
}

exports.name = 'cartesian';

exports.attr = ['xaxis', 'yaxis'];

exports.idRoot = ['x', 'y'];

exports.idRegex = constants.idRegex;

exports.attrRegex = constants.attrRegex;

exports.attributes = require('./attributes');

exports.layoutAttributes = require('./layout_attributes');

exports.supplyLayoutDefaults = require('./layout_defaults');

exports.transitionAxes = require('./transition_axes');

exports.finalizeSubplots = function(layoutIn, layoutOut) {
    var subplots = layoutOut._subplots;
    var xList = subplots.xaxis;
    var yList = subplots.yaxis;
    var spSVG = subplots.cartesian;
    var spAll = spSVG.concat(subplots.gl2d || []);
    var allX = {};
    var allY = {};
    var i, xi, yi;

    for(i = 0; i < spAll.length; i++) {
        var parts = spAll[i].split('y');
        allX[parts[0]] = 1;
        allY['y' + parts[1]] = 1;
    }

    // check for x axes with no subplot, and make one from the anchor of that x axis
    for(i = 0; i < xList.length; i++) {
        xi = xList[i];
        if(!allX[xi]) {
            yi = (layoutIn[axisIds.id2name(xi)] || {}).anchor;
            if(!constants.idRegex.y.test(yi)) yi = 'y';
            spSVG.push(xi + yi);
            spAll.push(xi + yi);

            if(!allY[yi]) {
                allY[yi] = 1;
                Lib.pushUnique(yList, yi);
            }
        }
    }

    // same for y axes with no subplot
    for(i = 0; i < yList.length; i++) {
        yi = yList[i];
        if(!allY[yi]) {
            xi = (layoutIn[axisIds.id2name(yi)] || {}).anchor;
            if(!constants.idRegex.x.test(xi)) xi = 'x';
            spSVG.push(xi + yi);
            spAll.push(xi + yi);

            if(!allX[xi]) {
                allX[xi] = 1;
                Lib.pushUnique(xList, xi);
            }
        }
    }

    // finally, if we've gotten here we're supposed to show cartesian...
    // so if there are NO subplots at all, make one from the first
    // x & y axes in the input layout
    if(!spAll.length) {
        xi = '';
        yi = '';
        for(var ki in layoutIn) {
            if(constants.attrRegex.test(ki)) {
                var axLetter = ki.charAt(0);
                if(axLetter === 'x') {
                    if(!xi || (+ki.substr(5) < +xi.substr(5))) {
                        xi = ki;
                    }
                } else if(!yi || (+ki.substr(5) < +yi.substr(5))) {
                    yi = ki;
                }
            }
        }
        xi = xi ? axisIds.name2id(xi) : 'x';
        yi = yi ? axisIds.name2id(yi) : 'y';
        xList.push(xi);
        yList.push(yi);
        spSVG.push(xi + yi);
    }
};

/**
 * Cartesian.plot
 *
 * @param {DOM div | object} gd
 * @param {array (optional)} traces
 *  array of traces indices to plot
 *  if undefined, plots all cartesian traces,
 * @param {object} (optional) transitionOpts
 *  transition option object
 * @param {function} (optional) makeOnCompleteCallback
 *  transition make callback function from Plots.transition
 */
exports.plot = function(gd, traces, transitionOpts, makeOnCompleteCallback) {
    var fullLayout = gd._fullLayout;
    var subplots = fullLayout._subplots.cartesian;
    var calcdata = gd.calcdata;
    var i;

    if(!Array.isArray(traces)) {
        // If traces is not provided, then it's a complete replot and missing
        // traces are removed
        traces = [];
        for(i = 0; i < calcdata.length; i++) traces.push(i);
    }

    for(i = 0; i < subplots.length; i++) {
        var subplot = subplots[i];
        var subplotInfo = fullLayout._plots[subplot];

        // Get all calcdata for this subplot:
        var cdSubplot = [];
        var pcd;

        for(var j = 0; j < calcdata.length; j++) {
            var cd = calcdata[j];
            var trace = cd[0].trace;

            // Skip trace if whitelist provided and it's not whitelisted:
            // if (Array.isArray(traces) && traces.indexOf(i) === -1) continue;
            if(trace.xaxis + trace.yaxis === subplot) {
                // XXX: Should trace carpet dependencies. Only replot all carpet plots if the carpet
                // axis has actually changed:
                //
                // If this trace is specifically requested, add it to the list:
                if(traces.indexOf(trace.index) !== -1 || trace.carpet) {
                    // Okay, so example: traces 0, 1, and 2 have fill = tonext. You animate
                    // traces 0 and 2. Trace 1 also needs to be updated, otherwise its fill
                    // is outdated. So this retroactively adds the previous trace if the
                    // traces are interdependent.
                    if(
                        pcd &&
                        pcd[0].trace.xaxis + pcd[0].trace.yaxis === subplot &&
                        ['tonextx', 'tonexty', 'tonext'].indexOf(trace.fill) !== -1 &&
                        cdSubplot.indexOf(pcd) === -1
                    ) {
                        cdSubplot.push(pcd);
                    }

                    cdSubplot.push(cd);
                }

                // Track the previous trace on this subplot for the retroactive-add step
                // above:
                pcd = cd;
            }
        }

        plotOne(gd, subplotInfo, cdSubplot, transitionOpts, makeOnCompleteCallback);
    }
};

function plotOne(gd, plotinfo, cdSubplot, transitionOpts, makeOnCompleteCallback) {
    var traceLayerClasses = constants.traceLayerClasses;
    var fullLayout = gd._fullLayout;
    var modules = fullLayout._modules;
    var _module, cdModuleAndOthers, cdModule;

    var layerData = [];
    var zoomScaleQueryParts = [];

    for(var i = 0; i < modules.length; i++) {
        _module = modules[i];
        var name = _module.name;
        var categories = Registry.modules[name].categories;

        if(categories.svg) {
            var className = (_module.layerName || name + 'layer');
            var plotMethod = _module.plot;

            // plot all visible traces of this type on this subplot at once
            cdModuleAndOthers = getModuleCalcData(cdSubplot, plotMethod);
            cdModule = cdModuleAndOthers[0];
            // don't need to search the found traces again - in fact we need to NOT
            // so that if two modules share the same plotter we don't double-plot
            cdSubplot = cdModuleAndOthers[1];

            if(cdModule.length) {
                layerData.push({
                    i: traceLayerClasses.indexOf(className),
                    className: className,
                    plotMethod: plotMethod,
                    cdModule: cdModule
                });
            }

            if(categories.zoomScale) {
                zoomScaleQueryParts.push('.' + className);
            }
        }
    }

    layerData.sort(function(a, b) { return a.i - b.i; });

    var layers = plotinfo.plot.selectAll('g.mlayer')
        .data(layerData, function(d) { return d.className; });

    layers.enter().append('g')
        .attr('class', function(d) { return d.className; })
        .classed('mlayer', true)
        .classed('rangeplot', plotinfo.isRangePlot);

    layers.exit().remove();

    layers.order();

    layers.each(function(d) {
        var sel = d3.select(this);
        var className = d.className;

        d.plotMethod(
            gd, plotinfo, d.cdModule, sel,
            transitionOpts, makeOnCompleteCallback
        );

        // layers that allow `cliponaxis: false`
        if(constants.clipOnAxisFalseQuery.indexOf('.' + className) === -1) {
            Drawing.setClipUrl(sel, plotinfo.layerClipId, gd);
        }
    });

    // call Scattergl.plot separately
    if(fullLayout._has('scattergl')) {
        _module = Registry.getModule('scattergl');
        cdModule = getModuleCalcData(cdSubplot, _module)[0];
        _module.plot(gd, plotinfo, cdModule);
    }

    // stash "hot" selections for faster interaction on drag and scroll
    if(!gd._context.staticPlot) {
        if(plotinfo._hasClipOnAxisFalse) {
            plotinfo.clipOnAxisFalseTraces = plotinfo.plot
                .selectAll(constants.clipOnAxisFalseQuery.join(','))
                .selectAll('.trace');
        }

        if(zoomScaleQueryParts.length) {
            var traces = plotinfo.plot
                .selectAll(zoomScaleQueryParts.join(','))
                .selectAll('.trace');

            plotinfo.zoomScalePts = traces.selectAll('path.point');
            plotinfo.zoomScaleTxt = traces.selectAll('.textpoint');
        }
    }
}

exports.style = function(gd) {
    var fullLayout = gd._fullLayout;
    var gs = fullLayout._size;
    var pad = gs.p;
    var axList = Axes.list(gd, '', true);
    var i, subplot, plotinfo, xa, ya;

    function overlappingDomain(xDomain, yDomain, domains) {
        for(var i = 0; i < domains.length; i++) {
            var existingX = domains[i][0];
            var existingY = domains[i][1];

            if(existingX[0] >= xDomain[1] || existingX[1] <= xDomain[0]) {
                continue;
            }
            if(existingY[0] < yDomain[1] && existingY[1] > yDomain[0]) {
                return true;
            }
        }
        return false;
    }

    function shouldShowLinesOrTicks(ax, subplot) {
        return (ax.ticks || ax.showline) &&
            (subplot === ax._mainSubplot || ax.mirror === 'all' || ax.mirror === 'allticks');
    }

    /*
     * should we draw a line on counterAx at this side of ax?
     * It's assumed that counterAx is known to overlay the subplot we're working on
     * but it may not be its main axis.
     */
    function shouldShowLineThisSide(ax, side, counterAx) {
        // does counterAx get a line at all?
        if(!counterAx.showline || !crispRoundLineWidth(ax)) return false;

        // are we drawing *all* lines for counterAx?
        if(counterAx.mirror === 'all' || counterAx.mirror === 'allticks') return true;

        var anchorAx = counterAx._anchorAxis;

        // is this a free axis? free axes can only have a subplot side-line with all(ticks)? mirroring
        if(!anchorAx) return false;

        // in order to handle cases where the user forgot to anchor this axis correctly
        // (because its default anchor has the same domain on the relevant end)
        // check whether the relevant position is the same.
        var sideIndex = FROM_BL[side];
        if(counterAx.side === side) {
            return anchorAx.domain[sideIndex] === ax.domain[sideIndex];
        }
        return counterAx.mirror && anchorAx.domain[1 - sideIndex] === ax.domain[1 - sideIndex];
    }

    /*
     * Is there another axis intersecting `side` end of `ax`?
     * First look at `counterAx` (the axis for this subplot),
     * then at all other potential counteraxes on or overlaying this subplot.
     * Take the line width from the first one that has a line.
     */
    function findCounterAxisLineWidth(ax, side, counterAx, axList) {
        if(shouldShowLineThisSide(ax, side, counterAx)) {
            return crispRoundLineWidth(counterAx);
        }
        for(var i = 0; i < axList.length; i++) {
            var axi = axList[i];
            if(axi._mainAxis === counterAx._mainAxis && shouldShowLineThisSide(ax, side, axi)) {
                return crispRoundLineWidth(axi);
            }
        }
        return 0;
    }

    function crispRoundLineWidth(ax) {
        return Drawing.crispRound(gd, ax.linewidth, 1);
    }

    // figure out which backgrounds we need to draw,
    // and in which layers to put them
    var lowerBackgroundIDs = [];
    var backgroundIds = [];
    var lowerDomains = [];
    // no need to draw background when paper and plot color are the same color,
    // activate mode just for large splom (which benefit the most from this
    // optimization), but this could apply to all cartesian subplots.
    var noNeedForBg = (
        Color.opacity(fullLayout.paper_bgcolor) === 1 &&
        Color.opacity(fullLayout.plot_bgcolor) === 1 &&
        fullLayout.paper_bgcolor === fullLayout.plot_bgcolor
    );

    for(subplot in fullLayout._plots) {
        plotinfo = fullLayout._plots[subplot];

        if(plotinfo.mainplot) {
            // mainplot is a reference to the main plot this one is overlaid on
            // so if it exists, this is an overlaid plot and we don't need to
            // give it its own background
            if(plotinfo.bg) {
                plotinfo.bg.remove();
            }
            plotinfo.bg = undefined;
        } else {
            var xDomain = plotinfo.xaxis.domain;
            var yDomain = plotinfo.yaxis.domain;
            var plotgroup = plotinfo.plotgroup;

            if(overlappingDomain(xDomain, yDomain, lowerDomains)) {
                var pgNode = plotgroup.node();
                var plotgroupBg = plotinfo.bg = Lib.ensureSingle(plotgroup, 'rect', 'bg');
                pgNode.insertBefore(plotgroupBg.node(), pgNode.childNodes[0]);
                backgroundIds.push(subplot);
            } else {
                plotgroup.select('rect.bg').remove();
                lowerDomains.push([xDomain, yDomain]);
                if(!noNeedForBg) {
                    lowerBackgroundIDs.push(subplot);
                    backgroundIds.push(subplot);
                }
            }
        }
    }

    // now create all the lower-layer backgrounds at once now that
    // we have the list of subplots that need them
    var lowerBackgrounds = fullLayout._bgLayer.selectAll('.bg')
        .data(lowerBackgroundIDs);

    lowerBackgrounds.enter().append('rect')
        .classed('bg', true);

    lowerBackgrounds.exit().remove();

    lowerBackgrounds.each(function(subplot) {
        fullLayout._plots[subplot].bg = d3.select(this);
    });

    // style all backgrounds
    for(i = 0; i < backgroundIds.length; i++) {
        plotinfo = fullLayout._plots[backgroundIds[i]];
        xa = plotinfo.xaxis;
        ya = plotinfo.yaxis;

        if(plotinfo.bg) {
            plotinfo.bg
                .call(Drawing.setRect,
                    xa._offset - pad, ya._offset - pad,
                    xa._length + 2 * pad, ya._length + 2 * pad)
                .call(Color.fill, fullLayout.plot_bgcolor)
                .style('stroke-width', 0);
        }
    }

    if(!fullLayout._hasOnlyLargeSploms) {
        for(subplot in fullLayout._plots) {
            plotinfo = fullLayout._plots[subplot];
            xa = plotinfo.xaxis;
            ya = plotinfo.yaxis;

            // Clip so that data only shows up on the plot area.
            var clipId = plotinfo.clipId = 'clip' + fullLayout._uid + subplot + 'plot';

            var plotClip = Lib.ensureSingleById(fullLayout._clips, 'clipPath', clipId, function(s) {
                s.classed('plotclip', true)
                    .append('rect');
            });

            plotinfo.clipRect = plotClip.select('rect').attr({
                width: xa._length,
                height: ya._length
            });

            Drawing.setTranslate(plotinfo.plot, xa._offset, ya._offset);

            var plotClipId;
            var layerClipId;

            if(plotinfo._hasClipOnAxisFalse) {
                plotClipId = null;
                layerClipId = clipId;
            } else {
                plotClipId = clipId;
                layerClipId = null;
            }

            Drawing.setClipUrl(plotinfo.plot, plotClipId, gd);

            // stash layer clipId value (null or same as clipId)
            // to DRY up Drawing.setClipUrl calls on trace-module and trace layers
            // downstream
            plotinfo.layerClipId = layerClipId;
        }
    }

    var xLinesXLeft, xLinesXRight, xLinesYBottom, xLinesYTop,
        leftYLineWidth, rightYLineWidth;
    var yLinesYBottom, yLinesYTop, yLinesXLeft, yLinesXRight,
        connectYBottom, connectYTop;
    var extraSubplot;

    function xLinePath(y) {
        return 'M' + xLinesXLeft + ',' + y + 'H' + xLinesXRight;
    }

    function xLinePathFree(y) {
        return 'M' + xa._offset + ',' + y + 'h' + xa._length;
    }

    function yLinePath(x) {
        return 'M' + x + ',' + yLinesYTop + 'V' + yLinesYBottom;
    }

    function yLinePathFree(x) {
        return 'M' + x + ',' + ya._offset + 'v' + ya._length;
    }

    function mainPath(ax, pathFn, pathFnFree) {
        if(!ax.showline || subplot !== ax._mainSubplot) return '';
        var mainLinePosition = Axes.getAxisLinePosition(gd, ax);
        if(!ax._anchorAxis) return pathFnFree(mainLinePosition);
        var out = pathFn(mainLinePosition);
        if(ax.mirror) out += pathFn(Axes.getAxisMirrorLinePosition(gd, ax));
        return out;
    }

    for(subplot in fullLayout._plots) {
        plotinfo = fullLayout._plots[subplot];
        xa = plotinfo.xaxis;
        ya = plotinfo.yaxis;

        /*
         * x lines get longer where they meet y lines, to make a crisp corner.
         * The x lines get the padding (margin.pad) plus the y line width to
         * fill up the corner nicely. Free x lines are excluded - they always
         * span exactly the data area of the plot
         *
         *  | XXXXX
         *  | XXXXX
         *  |
         *  +------
         *     x1
         *    -----
         *     x2
         */
        var xPath = 'M0,0';
        if(shouldShowLinesOrTicks(xa, subplot)) {
            leftYLineWidth = findCounterAxisLineWidth(xa, 'left', ya, axList);
            xLinesXLeft = xa._offset - (leftYLineWidth ? (pad + leftYLineWidth) : 0);
            rightYLineWidth = findCounterAxisLineWidth(xa, 'right', ya, axList);
            xLinesXRight = xa._offset + xa._length + (rightYLineWidth ? (pad + rightYLineWidth) : 0);
            xLinesYBottom = Axes.getAxisLinePosition(gd, xa, ya, 'bottom');
            xLinesYTop = Axes.getAxisLinePosition(gd, xa, ya, 'top');

            // save axis line positions for extra ticks to reference
            // each subplot that gets ticks from "allticks" gets an entry:
            //    [left or bottom, right or top]
            extraSubplot = (!xa._anchorAxis || subplot !== xa._mainSubplot);
            xPath = mainPath(xa, xLinePath, xLinePathFree);
            if(extraSubplot && xa.showline && (xa.mirror === 'all' || xa.mirror === 'allticks')) {
                xPath += xLinePath(xLinesYBottom) + xLinePath(xLinesYTop);
            }

            plotinfo.xlines
                .style('stroke-width', crispRoundLineWidth(xa) + 'px')
                .call(Color.stroke, xa.showline ? xa.linecolor : 'rgba(0,0,0,0)');
        }
        plotinfo.xlines.attr('d', xPath);

        /*
         * y lines that meet x axes get longer only by margin.pad, because
         * the x axes fill in the corner space. Free y axes, like free x axes,
         * always span exactly the data area of the plot
         *
         *   |   | XXXX
         * y2| y1| XXXX
         *   |   | XXXX
         *       |
         *       +-----
         */
        var yPath = 'M0,0';
        if(shouldShowLinesOrTicks(ya, subplot)) {
            connectYBottom = findCounterAxisLineWidth(ya, 'bottom', xa, axList);
            yLinesYBottom = ya._offset + ya._length + (connectYBottom ? pad : 0);
            connectYTop = findCounterAxisLineWidth(ya, 'top', xa, axList);
            yLinesYTop = ya._offset - (connectYTop ? pad : 0);
            yLinesXLeft = Axes.getAxisLinePosition(gd, ya, xa, 'left');
            yLinesXRight = Axes.getAxisLinePosition(gd, ya, xa, 'right');

            extraSubplot = (!ya._anchorAxis || subplot !== ya._mainSubplot);
            yPath = mainPath(ya, yLinePath, yLinePathFree);
            if(extraSubplot && ya.showline && (ya.mirror === 'all' || ya.mirror === 'allticks')) {
                yPath += yLinePath(yLinesXLeft) + yLinePath(yLinesXRight);
            }

            plotinfo.ylines
                .style('stroke-width', crispRoundLineWidth(ya) + 'px')
                .call(Color.stroke, ya.showline ? ya.linecolor : 'rgba(0,0,0,0)');
        }
        plotinfo.ylines.attr('d', yPath);
    }

    Axes.makeClipPaths(gd);

    return Plots.previousPromises(gd);
};

exports.clean = function(newFullData, newFullLayout, oldFullData, oldFullLayout) {
    var oldPlots = oldFullLayout._plots || {};
    var newPlots = newFullLayout._plots || {};
    var oldSubplotList = oldFullLayout._subplots || {};
    var plotinfo;
    var i, k;

    // when going from a large splom graph to something else,
    // we need to clear <g subplot> so that the new cartesian subplot
    // can have the correct layer ordering
    if(oldFullLayout._hasOnlyLargeSploms && !newFullLayout._hasOnlyLargeSploms) {
        for(k in oldPlots) {
            plotinfo = oldPlots[k];
            if(plotinfo.plotgroup) plotinfo.plotgroup.remove();
        }
    }

    var hadGl = (oldFullLayout._has && oldFullLayout._has('gl'));
    var hasGl = (newFullLayout._has && newFullLayout._has('gl'));

    if(hadGl && !hasGl) {
        for(k in oldPlots) {
            plotinfo = oldPlots[k];
            if(plotinfo._scene) plotinfo._scene.destroy();
        }
    }

    // delete any titles we don't need anymore
    // check if axis list has changed, and if so clear old titles
    if(oldSubplotList.xaxis && oldSubplotList.yaxis) {
        var oldAxIDs = axisIds.listIds({_fullLayout: oldFullLayout});
        for(i = 0; i < oldAxIDs.length; i++) {
            var oldAxId = oldAxIDs[i];
            if(!newFullLayout[axisIds.id2name(oldAxId)]) {
                oldFullLayout._infolayer.selectAll('.g-' + oldAxId + 'title').remove();
            }
        }
    }

    var hadCartesian = (oldFullLayout._has && oldFullLayout._has('cartesian'));
    var hasCartesian = (newFullLayout._has && newFullLayout._has('cartesian'));

    if(hadCartesian && !hasCartesian) {
        // if we've gotten rid of all cartesian traces, remove all the subplot svg items

        purgeSubplotLayers(oldFullLayout._cartesianlayer.selectAll('.subplot'), oldFullLayout);
        oldFullLayout._defs.selectAll('.axesclip').remove();
        delete oldFullLayout._axisConstraintGroups;
    } else if(oldSubplotList.cartesian) {
        // otherwise look for subplots we need to remove

        for(i = 0; i < oldSubplotList.cartesian.length; i++) {
            var oldSubplotId = oldSubplotList.cartesian[i];
            if(!newPlots[oldSubplotId]) {
                var selector = '.' + oldSubplotId + ',.' + oldSubplotId + '-x,.' + oldSubplotId + '-y';
                oldFullLayout._cartesianlayer.selectAll(selector).remove();
                removeSubplotExtras(oldSubplotId, oldFullLayout);
            }
        }
    }
};

exports.drawFramework = function(gd) {
    var fullLayout = gd._fullLayout;
    var subplotData = makeSubplotData(gd);

    var subplotLayers = fullLayout._cartesianlayer.selectAll('.subplot')
        .data(subplotData, String);

    subplotLayers.enter().append('g')
        .attr('class', function(d) { return 'subplot ' + d[0]; });

    subplotLayers.order();

    subplotLayers.exit()
        .call(purgeSubplotLayers, fullLayout);

    subplotLayers.each(function(d) {
        var id = d[0];
        var plotinfo = fullLayout._plots[id];

        plotinfo.plotgroup = d3.select(this);
        makeSubplotLayer(gd, plotinfo);

        // make separate drag layers for each subplot,
        // but append them to paper rather than the plot groups,
        // so they end up on top of the rest
        plotinfo.draglayer = ensureSingle(fullLayout._draggers, 'g', id);
    });
};

exports.rangePlot = function(gd, plotinfo, cdSubplot) {
    makeSubplotLayer(gd, plotinfo);
    plotOne(gd, plotinfo, cdSubplot);
    Plots.style(gd);
};

function makeSubplotData(gd) {
    var fullLayout = gd._fullLayout;
    var ids = fullLayout._subplots.cartesian;
    var len = ids.length;
    var i, j, id, plotinfo, xa, ya;

    // split 'regular' and 'overlaying' subplots
    var regulars = [];
    var overlays = [];

    for(i = 0; i < len; i++) {
        id = ids[i];
        plotinfo = fullLayout._plots[id];
        xa = plotinfo.xaxis;
        ya = plotinfo.yaxis;

        var xa2 = xa._mainAxis;
        var ya2 = ya._mainAxis;
        var mainplot = xa2._id + ya2._id;
        var mainplotinfo = fullLayout._plots[mainplot];
        plotinfo.overlays = [];

        if(mainplot !== id && mainplotinfo) {
            plotinfo.mainplot = mainplot;
            plotinfo.mainplotinfo = mainplotinfo;
            overlays.push(id);
        } else {
            plotinfo.mainplot = undefined;
            plotinfo.mainPlotinfo = undefined;
            regulars.push(id);
        }
    }

    // fill in list of overlaying subplots in 'main plot'
    for(i = 0; i < overlays.length; i++) {
        id = overlays[i];
        plotinfo = fullLayout._plots[id];
        plotinfo.mainplotinfo.overlays.push(plotinfo);
    }

    // put 'regular' subplot data before 'overlaying'
    var subplotIds = regulars.concat(overlays);
    var subplotData = new Array(len);

    for(i = 0; i < len; i++) {
        id = subplotIds[i];
        plotinfo = fullLayout._plots[id];
        xa = plotinfo.xaxis;
        ya = plotinfo.yaxis;

        // use info about axis layer and overlaying pattern
        // to clean what need to be cleaned up in exit selection
        var d = [id, xa.layer, ya.layer, xa.overlaying || '', ya.overlaying || ''];
        for(j = 0; j < plotinfo.overlays.length; j++) {
            d.push(plotinfo.overlays[j].id);
        }
        subplotData[i] = d;
    }

    return subplotData;
}

function makeSubplotLayer(gd, plotinfo) {
    var plotgroup = plotinfo.plotgroup;
    var id = plotinfo.id;
    var xLayer = constants.layerValue2layerClass[plotinfo.xaxis.layer];
    var yLayer = constants.layerValue2layerClass[plotinfo.yaxis.layer];
    var hasOnlyLargeSploms = gd._fullLayout._hasOnlyLargeSploms;

    if(!plotinfo.mainplot) {
        if(hasOnlyLargeSploms) {
            // TODO could do even better
            // - we don't need plot (but we would have to mock it in lsInner
            //   and other places
            // - we don't (x|y)lines and (x|y)axislayer for most subplots
            //   usually just the bottom x and left y axes.
            plotinfo.xlines = ensureSingle(plotgroup, 'path', 'xlines-above');
            plotinfo.ylines = ensureSingle(plotgroup, 'path', 'ylines-above');
            plotinfo.xaxislayer = ensureSingle(plotgroup, 'g', 'xaxislayer-above');
            plotinfo.yaxislayer = ensureSingle(plotgroup, 'g', 'yaxislayer-above');
        } else {
            var backLayer = ensureSingle(plotgroup, 'g', 'layer-subplot');
            plotinfo.shapelayer = ensureSingle(backLayer, 'g', 'shapelayer');
            plotinfo.imagelayer = ensureSingle(backLayer, 'g', 'imagelayer');

            plotinfo.gridlayer = ensureSingle(plotgroup, 'g', 'gridlayer');
            plotinfo.zerolinelayer = ensureSingle(plotgroup, 'g', 'zerolinelayer');

            ensureSingle(plotgroup, 'path', 'xlines-below');
            ensureSingle(plotgroup, 'path', 'ylines-below');
            plotinfo.overlinesBelow = ensureSingle(plotgroup, 'g', 'overlines-below');

            ensureSingle(plotgroup, 'g', 'xaxislayer-below');
            ensureSingle(plotgroup, 'g', 'yaxislayer-below');
            plotinfo.overaxesBelow = ensureSingle(plotgroup, 'g', 'overaxes-below');

            plotinfo.plot = ensureSingle(plotgroup, 'g', 'plot');
            plotinfo.overplot = ensureSingle(plotgroup, 'g', 'overplot');

            plotinfo.xlines = ensureSingle(plotgroup, 'path', 'xlines-above');
            plotinfo.ylines = ensureSingle(plotgroup, 'path', 'ylines-above');
            plotinfo.overlinesAbove = ensureSingle(plotgroup, 'g', 'overlines-above');

            ensureSingle(plotgroup, 'g', 'xaxislayer-above');
            ensureSingle(plotgroup, 'g', 'yaxislayer-above');
            plotinfo.overaxesAbove = ensureSingle(plotgroup, 'g', 'overaxes-above');

            // set refs to correct layers as determined by 'axis.layer'
            plotinfo.xlines = plotgroup.select('.xlines-' + xLayer);
            plotinfo.ylines = plotgroup.select('.ylines-' + yLayer);
            plotinfo.xaxislayer = plotgroup.select('.xaxislayer-' + xLayer);
            plotinfo.yaxislayer = plotgroup.select('.yaxislayer-' + yLayer);
        }
    } else {
        var mainplotinfo = plotinfo.mainplotinfo;
        var mainplotgroup = mainplotinfo.plotgroup;
        var xId = id + '-x';
        var yId = id + '-y';

        // now make the components of overlaid subplots
        // overlays don't have backgrounds, and append all
        // their other components to the corresponding
        // extra groups of their main plots.

        plotinfo.gridlayer = mainplotinfo.gridlayer;
        plotinfo.zerolinelayer = mainplotinfo.zerolinelayer;

        ensureSingle(mainplotinfo.overlinesBelow, 'path', xId);
        ensureSingle(mainplotinfo.overlinesBelow, 'path', yId);
        ensureSingle(mainplotinfo.overaxesBelow, 'g', xId);
        ensureSingle(mainplotinfo.overaxesBelow, 'g', yId);

        plotinfo.plot = ensureSingle(mainplotinfo.overplot, 'g', id);

        ensureSingle(mainplotinfo.overlinesAbove, 'path', xId);
        ensureSingle(mainplotinfo.overlinesAbove, 'path', yId);
        ensureSingle(mainplotinfo.overaxesAbove, 'g', xId);
        ensureSingle(mainplotinfo.overaxesAbove, 'g', yId);

        // set refs to correct layers as determined by 'abovetraces'
        plotinfo.xlines = mainplotgroup.select('.overlines-' + xLayer).select('.' + xId);
        plotinfo.ylines = mainplotgroup.select('.overlines-' + yLayer).select('.' + yId);
        plotinfo.xaxislayer = mainplotgroup.select('.overaxes-' + xLayer).select('.' + xId);
        plotinfo.yaxislayer = mainplotgroup.select('.overaxes-' + yLayer).select('.' + yId);
    }

    // common attributes for all subplots, overlays or not

    if(!hasOnlyLargeSploms) {
        ensureSingleAndAddDatum(plotinfo.gridlayer, 'g', plotinfo.xaxis._id);
        ensureSingleAndAddDatum(plotinfo.gridlayer, 'g', plotinfo.yaxis._id);
        plotinfo.gridlayer.selectAll('g')
            .map(function(d) { return d[0]; })
            .sort(axisIds.idSort);
    }

    plotinfo.xlines
        .style('fill', 'none')
        .classed('crisp', true);

    plotinfo.ylines
        .style('fill', 'none')
        .classed('crisp', true);
}

function purgeSubplotLayers(layers, fullLayout) {
    if(!layers) return;

    var overlayIdsToRemove = {};

    layers.each(function(d) {
        var id = d[0];
        var plotgroup = d3.select(this);

        plotgroup.remove();
        removeSubplotExtras(id, fullLayout);
        overlayIdsToRemove[id] = true;

        // do not remove individual axis <clipPath>s here
        // as other subplots may need them
    });

    // must remove overlaid subplot trace layers 'manually'

    for(var k in fullLayout._plots) {
        var subplotInfo = fullLayout._plots[k];
        var overlays = subplotInfo.overlays || [];

        for(var j = 0; j < overlays.length; j++) {
            var overlayInfo = overlays[j];

            if(overlayIdsToRemove[overlayInfo.id]) {
                overlayInfo.plot.selectAll('.trace').remove();
            }
        }
    }
}

function removeSubplotExtras(subplotId, fullLayout) {
    fullLayout._draggers.selectAll('g.' + subplotId).remove();
    fullLayout._defs.select('#clip' + fullLayout._uid + subplotId + 'plot').remove();
}

exports.toSVG = function(gd) {
    var imageRoot = gd._fullLayout._glimages;
    var root = d3.select(gd).selectAll('.svg-container');
    var canvases = root.filter(function(d, i) {return i === root.size() - 1;})
        .selectAll('.gl-canvas-context, .gl-canvas-focus');

    function canvasToImage() {
        var canvas = this;
        var imageData = canvas.toDataURL('image/png');
        var image = imageRoot.append('svg:image');

        image.attr({
            xmlns: xmlnsNamespaces.svg,
            'xlink:href': imageData,
            preserveAspectRatio: 'none',
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height
        });
    }

    canvases.each(canvasToImage);
};

exports.updateFx = require('./graph_interact').updateFx;

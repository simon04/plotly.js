/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var Registry = require('../registry');
var Plots = require('../plots/plots');

var Lib = require('../lib');
var clearGlCanvases = require('../lib/clear_gl_canvases');

var Drawing = require('../components/drawing');
var Titles = require('../components/titles');
var ModeBar = require('../components/modebar');

var Axes = require('../plots/cartesian/axes');
var alignmentConstants = require('../constants/alignment');
var axisConstraints = require('../plots/cartesian/constraints');
var enforceAxisConstraints = axisConstraints.enforce;
var cleanAxisConstraints = axisConstraints.clean;
var doAutoRange = require('../plots/cartesian/autorange').doAutoRange;

exports.layoutStyles = function(gd) {
    var fullLayout = gd._fullLayout;

    var responsiveAutosize = gd._context.responsive && fullLayout.autosize;
    fullLayout._paperdiv.style({
        width: (responsiveAutosize && !gd._context._hasZeroWidth && !gd.layout.width) ?
            '100%' : fullLayout.width + 'px',
        height: (responsiveAutosize && !gd._context._hasZeroHeight && !gd.layout.height) ?
            '100%' : fullLayout.height + 'px'
    })
    .selectAll('.main-svg')
    .call(Drawing.setSize, fullLayout.width, fullLayout.height);

    gd._context.setBackground(gd, fullLayout.paper_bgcolor);

    var basePlotModules = fullLayout._basePlotModules;
    for(var i = 0; i < basePlotModules.length; i++) {
        var styleFn = basePlotModules[i].style;
        if(styleFn) styleFn(gd);
    }

    if(fullLayout.modebar.orientation === 'h') {
        fullLayout._modebardiv
          .style('height', null)
          .style('width', '100%');
    } else {
        fullLayout._modebardiv
          .style('width', null)
          .style('height', fullLayout.height + 'px');
    }
    ModeBar.manage(gd);
};

exports.drawMainTitle = function(gd) {
    var fullLayout = gd._fullLayout;
    var title = fullLayout.title;
    var gs = fullLayout._size;

    var textAnchor = Lib.isRightAnchor(title) ? 'end' :
        Lib.isLeftAnchor(title) ? 'start' :
        'middle';

    var dy = Lib.isTopAnchor(title) ? alignmentConstants.CAP_SHIFT :
        Lib.isMiddleAnchor(title) ? alignmentConstants.MID_SHIFT :
        '0';

    var hPadShift = textAnchor === 'start' ? title.psd.l :
        textAnchor === 'end' ? title.pad.r :
        0;

    var mainX = title.xref === 'paper' ?
        gs.l + gs.w * title.x + hPadShift :
        fullLayout.width * title.x + hPadShift;

    var vPadShift = !dy ? -title.pad.b :
        Lib.isMiddleAnchor(title) ? title.pad.t :
        0;

    var mainY = title.y === 'auto' ? gs.t / 2 :
        title.yref === 'paper' ? gs.t - gs.h * title.y + vPadShift :
            fullLayout.height * (1 - title.y) + vPadShift;

    Titles.draw(gd, 'gtitle', {
        propContainer: fullLayout,
        propName: 'title.text',
        placeholder: fullLayout._dfltTitle.plot,
        attributes: {
            x: mainX,
            y: mainY,
            'text-anchor': textAnchor,
            dy: dy + 'em'
        }
    });
};

exports.doTraceStyle = function(gd) {
    var calcdata = gd.calcdata;
    var editStyleCalls = [];
    var i;

    for(i = 0; i < calcdata.length; i++) {
        var cd = calcdata[i];
        var cd0 = cd[0] || {};
        var trace = cd0.trace || {};
        var _module = trace._module || {};

        // See if we need to do arraysToCalcdata
        // call it regardless of what change we made, in case
        // supplyDefaults brought in an array that was already
        // in gd.data but not in gd._fullData previously
        var arraysToCalcdata = _module.arraysToCalcdata;
        if(arraysToCalcdata) arraysToCalcdata(cd, trace);

        var editStyle = _module.editStyle;
        if(editStyle) editStyleCalls.push({fn: editStyle, cd0: cd0});
    }

    if(editStyleCalls.length) {
        for(i = 0; i < editStyleCalls.length; i++) {
            var edit = editStyleCalls[i];
            edit.fn(gd, edit.cd0);
        }
        clearGlCanvases(gd);
        exports.redrawReglTraces(gd);
    }

    Plots.style(gd);
    Registry.getComponentMethod('legend', 'draw')(gd);

    return Plots.previousPromises(gd);
};

exports.doColorBars = function(gd) {
    Registry.getComponentMethod('colorbar', 'draw')(gd);
    return Plots.previousPromises(gd);
};

// force plot() to redo the layout and replot with the modified layout
exports.layoutReplot = function(gd) {
    var layout = gd.layout;
    gd.layout = undefined;
    return Registry.call('plot', gd, '', layout);
};

exports.doLegend = function(gd) {
    Registry.getComponentMethod('legend', 'draw')(gd);
    return Plots.previousPromises(gd);
};

exports.doTicksRelayout = function(gd) {
    Axes.draw(gd, 'redraw');

    if(gd._fullLayout._hasOnlyLargeSploms) {
        Registry.subplotsRegistry.splom.updateGrid(gd);
        clearGlCanvases(gd);
        exports.redrawReglTraces(gd);
    }

    exports.drawMainTitle(gd);
    return Plots.previousPromises(gd);
};

exports.doModeBar = function(gd) {
    var fullLayout = gd._fullLayout;

    ModeBar.manage(gd);

    for(var i = 0; i < fullLayout._basePlotModules.length; i++) {
        var updateFx = fullLayout._basePlotModules[i].updateFx;
        if(updateFx) updateFx(gd);
    }

    return Plots.previousPromises(gd);
};

exports.doCamera = function(gd) {
    var fullLayout = gd._fullLayout;
    var sceneIds = fullLayout._subplots.gl3d;

    for(var i = 0; i < sceneIds.length; i++) {
        var sceneLayout = fullLayout[sceneIds[i]];
        var scene = sceneLayout._scene;

        var cameraData = sceneLayout.camera;
        scene.setCamera(cameraData);
    }
};

exports.drawData = function(gd) {
    var fullLayout = gd._fullLayout;

    clearGlCanvases(gd);

    // loop over the base plot modules present on graph
    var basePlotModules = fullLayout._basePlotModules;
    for(var i = 0; i < basePlotModules.length; i++) {
        basePlotModules[i].plot(gd);
    }

    exports.redrawReglTraces(gd);

    // styling separate from drawing
    Plots.style(gd);

    // draw components that can be drawn on axes,
    // and that do not push the margins
    Registry.getComponentMethod('shapes', 'draw')(gd);
    Registry.getComponentMethod('annotations', 'draw')(gd);
    Registry.getComponentMethod('images', 'draw')(gd);

    return Plots.previousPromises(gd);
};

// Draw (or redraw) all regl-based traces in one go,
// useful during drag and selection where buffers of targeted traces are updated,
// but all traces need to be redrawn following clearGlCanvases.
//
// Note that _module.plot for regl trace does NOT draw things
// on the canvas, they only update the buffers.
// Drawing is perform here.
//
// TODO try adding per-subplot option using gl.SCISSOR_TEST for
// non-overlaying, disjoint subplots.
//
// TODO try to include parcoords in here.
// https://github.com/plotly/plotly.js/issues/3069
exports.redrawReglTraces = function(gd) {
    var fullLayout = gd._fullLayout;

    if(fullLayout._has('regl')) {
        var fullData = gd._fullData;
        var cartesianIds = [];
        var polarIds = [];
        var i, sp;

        if(fullLayout._hasOnlyLargeSploms) {
            fullLayout._splomGrid.draw();
        }

        // N.B.
        // - Loop over fullData (not _splomScenes) to preserve splom trace-to-trace ordering
        // - Fill list if subplot ids (instead of fullLayout._subplots) to handle cases where all traces
        //   of a given module are `visible !== true`
        for(i = 0; i < fullData.length; i++) {
            var trace = fullData[i];

            if(trace.visible === true && trace._length !== 0) {
                if(trace.type === 'splom') {
                    fullLayout._splomScenes[trace.uid].draw();
                } else if(trace.type === 'scattergl') {
                    Lib.pushUnique(cartesianIds, trace.xaxis + trace.yaxis);
                } else if(trace.type === 'scatterpolargl') {
                    Lib.pushUnique(polarIds, trace.subplot);
                }
            }
        }

        for(i = 0; i < cartesianIds.length; i++) {
            sp = fullLayout._plots[cartesianIds[i]];
            if(sp._scene) sp._scene.draw();
        }

        for(i = 0; i < polarIds.length; i++) {
            sp = fullLayout[polarIds[i]]._subplot;
            if(sp._scene) sp._scene.draw();
        }
    }
};

exports.doAutoRangeAndConstraints = function(gd) {
    var fullLayout = gd._fullLayout;
    var axList = Axes.list(gd, '', true);
    var matchGroups = fullLayout._axisMatchGroups || [];
    var ax;
    var axRng;

    for(var i = 0; i < axList.length; i++) {
        ax = axList[i];
        cleanAxisConstraints(gd, ax);
        doAutoRange(gd, ax);
    }

    enforceAxisConstraints(gd);

    groupLoop:
    for(var j = 0; j < matchGroups.length; j++) {
        var group = matchGroups[j];
        var rng = null;
        var id;

        for(id in group) {
            ax = Axes.getFromId(gd, id);
            if(ax.autorange === false) continue groupLoop;

            axRng = Lib.simpleMap(ax.range, ax.r2l);
            if(rng) {
                if(rng[0] < rng[1]) {
                    rng[0] = Math.min(rng[0], axRng[0]);
                    rng[1] = Math.max(rng[1], axRng[1]);
                } else {
                    rng[0] = Math.max(rng[0], axRng[0]);
                    rng[1] = Math.min(rng[1], axRng[1]);
                }
            } else {
                rng = axRng;
            }
        }

        for(id in group) {
            ax = Axes.getFromId(gd, id);
            ax.range = Lib.simpleMap(rng, ax.l2r);
            ax._input.range = ax.range.slice();
            ax.setScale();
        }
    }
};

// TODO figure out how to split finalDraw / drawMarginPushers

exports.finalDraw = function(gd) {
    // TODO: rangesliders really belong in marginPushers but they need to be
    // drawn after data - can we at least get the margin pushing part separated
    // out and done earlier?
    Registry.getComponentMethod('rangeslider', 'draw')(gd);
    // TODO: rangeselector only needs to be here (in addition to drawMarginPushers)
    // because the margins need to be fully determined before we can call
    // autorange and update axis ranges (which rangeselector needs to know which
    // button is active). Can we break out its automargin step from its draw step?
    Registry.getComponentMethod('rangeselector', 'draw')(gd);
};

exports.drawMarginPushers = function(gd) {
    Registry.getComponentMethod('legend', 'draw')(gd);
    Registry.getComponentMethod('rangeselector', 'draw')(gd);
    Registry.getComponentMethod('sliders', 'draw')(gd);
    Registry.getComponentMethod('updatemenus', 'draw')(gd);
    Registry.getComponentMethod('colorbar', 'draw')(gd);
};

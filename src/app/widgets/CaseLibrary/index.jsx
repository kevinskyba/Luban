import classNames from 'classnames';

import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import log from '../../lib/log';
import { MACHINE_SERIES } from '../../constants';
import api from '../../api';
import modal from '../../lib/modal';
import { timestamp } from '../../../shared/lib/random-utils';
import { CaseConfigOriginal, CaseConfig150, CaseConfig250, CaseConfig350 } from './CaseConfig';
import { actions as printingActions } from '../../flux/printing';
import { actions as editorActions } from '../../flux/editor';
import i18n from '../../lib/i18n';
import styles from './index.styl';

class CaseLibrary extends PureComponent {
    static propTypes = {
        series: PropTypes.string.isRequired,
        headType: PropTypes.string,
        isConnected: PropTypes.bool,
        // laser: PropTypes.object.isRequired,
        insertDefaultCncTextVector: PropTypes.func.isRequired,
        insertDefaultLaserTextVector: PropTypes.func.isRequired,
        updateDefaultAdvised: PropTypes.func.isRequired,
        updateDefaultMaterialId: PropTypes.func.isRequired,
        updateDefaultQualityId: PropTypes.func.isRequired,
        qualityDefinitions: PropTypes.array.isRequired,
        materialDefinitions: PropTypes.array.isRequired,
        updateActiveDefinition: PropTypes.func.isRequired,
        updateDefinitionSettings: PropTypes.func.isRequired,
        duplicateMaterialDefinition: PropTypes.func.isRequired,
        duplicateQualityDefinition: PropTypes.func.isRequired,
        removeAllModels: PropTypes.func.isRequired,
        uploadCaseModel: PropTypes.func.isRequired,
        uploadCncCaseImage: PropTypes.func.isRequired,
        uploadLaserCaseImage: PropTypes.func.isRequired
    };


    state = {
    };

    actions = {
        load3dpCaseSettings: async (config) => {
            const materialDefinitionId = config.material.definitionId;
            const materialDefinition = this.props.materialDefinitions.find(d => d.definitionId === materialDefinitionId);
            if (materialDefinition) {
                this.props.updateDefaultMaterialId(materialDefinitionId);
                this.props.updateActiveDefinition(materialDefinition);
            } else {
                const defaultDefinition = this.props.materialDefinitions.find(d => d.definitionId === 'material.pla');
                const addDefinition = config.material;
                const newDefinition = await this.props.duplicateMaterialDefinition(defaultDefinition, materialDefinitionId, materialDefinitionId);
                for (const key of defaultDefinition.ownKeys) {
                    if (addDefinition[key] === undefined) {
                        continue;
                    }
                    newDefinition.settings[key].default_value = addDefinition[key];
                    newDefinition.settings[key].from = addDefinition.definitionId;
                }
                // Select new definition after creation
                this.props.updateDefaultMaterialId(newDefinition.definitionId);
                this.props.updateDefinitionSettings(newDefinition, newDefinition.settings);
                this.props.updateActiveDefinition(newDefinition);
            }

            const qualityDefinitionId = config.quality.definitionId;
            const qualityDefinition = await this.props.qualityDefinitions.find(d => d.definitionId === qualityDefinitionId);
            if (qualityDefinition) {
                if (['quality.fast_print', 'quality.normal_quality', 'quality.high_quality'].indexOf(qualityDefinitionId) === -1) {
                    this.props.updateDefaultAdvised(false);
                } else {
                    this.props.updateDefaultAdvised(true);
                }
                this.props.updateDefaultQualityId(qualityDefinitionId);
                this.props.updateActiveDefinition(qualityDefinition);
            } else {
                const defaultDefinition = this.props.qualityDefinitions.find(d => d.definitionId === 'quality.normal_quality');
                const addDefinition = config.quality;
                const newDefinition = await this.props.duplicateQualityDefinition(defaultDefinition, qualityDefinitionId, qualityDefinitionId);
                for (const key of defaultDefinition.ownKeys) {
                    if (newDefinition.settings[key] === undefined) {
                        continue;
                    }
                    if (addDefinition[key] !== undefined) {
                        newDefinition.settings[key].default_value = addDefinition[key];
                        newDefinition.settings[key].from = addDefinition.definitionId;
                    }
                }
                this.props.updateDefaultAdvised(false);

                this.props.updateDefaultQualityId(newDefinition.definitionId);
                this.props.updateDefinitionSettings(newDefinition, newDefinition.settings);
                this.props.updateActiveDefinition(newDefinition);
            }
        },
        loadLaserCncCaseSettings: async (config) => {
            if (config.mode === 'trace') {
                const res = await api.uploadLaserCaseImage(config.pathConfig, config.mode, () => {
                    modal({
                        title: i18n._('Parse Image Error'),
                        body: i18n._('Failed to parse image file {{filename}}', { filename: config.pathConfig.name })
                    });
                });
                const result = await api.processTrace({
                    originalName: res.body.originalName,
                    uploadName: res.body.uploadName,
                    width: res.body.width,
                    height: res.body.height
                });
                log.warn('trace', res, result);
            } else if (config.mode === 'text') {
                if (config.tag === 'laser') {
                    await this.props.insertDefaultLaserTextVector(config.caseConfigs, config.caseTransformation);
                } else {
                    await this.props.insertDefaultCncTextVector(config.caseConfigs, config.caseTransformation);
                }
            } else {
                if (config.tag === 'laser') {
                    await this.props.uploadLaserCaseImage(config.pathConfig, config.mode, config.caseConfigs, config.caseTransformation, () => {
                        modal({
                            title: i18n._('Parse Image Error'),
                            body: i18n._('Failed to parse image file {{filename}}', { filename: config.pathConfig.name })
                        });
                    });
                } else {
                    await this.props.uploadCncCaseImage(config.pathConfig, config.mode, config.caseConfigs, config.caseTransformation, () => {
                        modal({
                            title: i18n._('Parse Image Error'),
                            body: i18n._('Failed to parse image file {{filename}}', { filename: config.pathConfig.name })
                        });
                    });
                }
            }
        }
    };

    loadCase = (config) => {
        document.location.href = `/#/${config.tag}`;
        if (config.tag === '3dp') {
            this.actions.load3dpCaseSettings(config);
            this.props.removeAllModels();
            this.props.uploadCaseModel(config.pathConfig);
        } else {
            this.actions.loadLaserCncCaseSettings(config);
        }
    };

    render() {
        let CaseConfig;
        if (this.props.series === MACHINE_SERIES.ORIGINAL.value) {
            CaseConfig = CaseConfigOriginal;
        } else if (this.props.series === MACHINE_SERIES.CUSTOM.value) {
            CaseConfig = CaseConfigOriginal;
        } else if (this.props.series === MACHINE_SERIES.A150.value) {
            CaseConfig = CaseConfig150;
        } else if (this.props.series === MACHINE_SERIES.A250.value) {
            CaseConfig = CaseConfig250;
        } else if (this.props.series === MACHINE_SERIES.A350.value) {
            CaseConfig = CaseConfig350;
        } else {
            CaseConfig = CaseConfig150;
        }
        return (
            <div className={styles.caselibrary}>

                <div className={classNames(styles.container, styles.usecase)}>
                    <h2 className={styles.mainTitle}>
                        {i18n._('Featured Projects')}
                    </h2>
                    <div className={styles.columns}>
                        { CaseConfig.map((config) => {
                            return (
                                <div
                                    className={styles.column}
                                    key={config.pathConfig.name + timestamp()}
                                >
                                    <div>
                                        <img className={styles.imgIcon} src={config.imgSrc} alt="" />
                                    </div>
                                    <div className={styles.cardtext}>
                                        <h4>{config.title}</h4>
                                        <p>{i18n._('by Snapmaker')}</p>
                                    </div>

                                    <button
                                        type="button"
                                        className={classNames(
                                            'sm-btn-large',
                                            'sm-btn-default',
                                            styles.load,
                                        )}
                                        disabled={this.props.isConnected && this.props.headType !== config.tag}
                                        onClick={() => this.loadCase(config)}
                                    >
                                        {i18n._('load')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        );
    }
}

const mapStateToProps = (state) => {
    const printing = state.printing;
    const machine = state.machine;
    const { qualityDefinitions, materialDefinitions, defaultMaterialId, activeDefinition } = printing;
    return {
        materialDefinitions,
        series: machine.series,
        headType: machine.headType,
        isConnected: machine.isConnected,
        defaultMaterialId,
        qualityDefinitions,
        activeDefinition
    };
};


const mapDispatchToProps = (dispatch) => ({
    insertDefaultLaserTextVector: (caseConfigs, caseTransformation) => dispatch(editorActions.insertDefaultTextVector('laser', caseConfigs, caseTransformation)),
    insertDefaultCncTextVector: (caseConfigs, caseTransformation) => dispatch(editorActions.insertDefaultTextVector('cnc', caseConfigs, caseTransformation)),
    // uploadFont: (file) => dispatch(textActions.uploadFont(file)),
    updateLaserState: (params) => dispatch(editorActions.updateState('laser', params)),
    uploadLaserCaseImage: (file, mode, caseConfigs, caseTransformation, onFailure) => dispatch(editorActions.uploadCaseImage('laser', file, mode, caseConfigs, caseTransformation, onFailure)),
    uploadCncCaseImage: (file, mode, caseConfigs, caseTransformation, onFailure) => dispatch(editorActions.uploadCaseImage('cnc', file, mode, caseConfigs, caseTransformation, onFailure)),
    updateDefaultAdvised: (isAdvised) => dispatch(printingActions.updateState({ 'isAdvised': isAdvised })),
    updateDefaultMaterialId: (defaultMaterialId) => dispatch(printingActions.updateState({ defaultMaterialId })),
    updateDefaultQualityId: (defaultQualityId) => dispatch(printingActions.updateState({ defaultQualityId })),
    updateActiveDefinition: (definition, shouldSave = false) => dispatch(printingActions.updateActiveDefinition(definition, shouldSave)),
    updateDefinitionSettings: (definition, settings) => dispatch(printingActions.updateDefinitionSettings(definition, settings)),
    duplicateMaterialDefinition: (definition, newDefinitionId, newDefinitionName) => dispatch(printingActions.duplicateMaterialDefinition(definition, newDefinitionId, newDefinitionName)),
    duplicateQualityDefinition: (definition, newDefinitionId, newDefinitionName) => dispatch(printingActions.duplicateQualityDefinition(definition, newDefinitionId, newDefinitionName)),
    removeAllModels: () => dispatch(printingActions.removeAllModels()),
    uploadCaseModel: (file) => dispatch(printingActions.uploadCaseModel(file))
});


export default connect(mapStateToProps, mapDispatchToProps)(CaseLibrary);

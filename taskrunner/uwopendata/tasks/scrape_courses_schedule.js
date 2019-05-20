const approot = require('app-root-path');
const logger = require(`${approot}/config/winston`)('scape_courses_schedule task');
const fs = require('fs');
const Course = require(`${approot}/models/Course`);
const uwapi = require('../config/uwopendata_api');
const timeout = require(`${approot}/utils/delay`);

/**
 * Update our course schedule with new changes from UW API
 *
 * First, read the latest archived list of courses created by `scrape_courses`.
 * Terminates if the archived list of not found.
 * Then, for each course in the list, send a request to 
 * `/courses/subject/catalog_number/schedule` to obtain the new schedule.
 * 
 * 
 * 
 * First, request all the available course.
 * Compare it with the saved collection from last time.
 * If the collection does not exist, update every Course
 * If the collection exists, update only the difference
 *
 * @param options
 * @returns {Promise<void>}
 */
module.exports = async (options) => {
    logger.info(`Starting scrape_courses_schedule`);

    options = Object.assign({
        listCoursesArchivePath: `${approot}/uwopendata/data/courses_array.json`,
        archiveEncoding: 'utf8',
        batchSize: 300,
        batchDelay: 500,
    }, options);

    let listCourses = []; // list of courses by course_id

    // Read the list of courses created by scrape_courses
    // Terminates if the list is not found
    try {
        listCourses = JSON.parse(await fs.promises.readFile(options.listCoursesArchivePath, options.archiveEncoding));
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.verbose(`${options.listCoursesArchivePath} does not exist`);
            logger.info(`scrape_courses_schedule failed`);
            return;
        } else throw Error(err);
    }

    let queue = []; // a queue of HTTP request, each item is for one course

    for (const e of listCourses) {
        queue.push({endpoint: `/courses/${e.subject}/${e.catalog_number}/schedule`, qs: {}});
    }

    let listSchedule = [];
    let currentTerm;
    let listNewCurrentTermSchedule = [];

    const requestInBatch = async () => {
        let progress = 0;
        while (queue.length > 0) {
            let batchResult = await Promise.all(queue.slice(0, options.batchSize)
                .map(e => uwapi.get(e.endpoint, e.qs)));
            queue = queue.slice(options.batchSize);
            await timeout(options.batchDelay);
            for (let [index, item] of batchResult) {
                let itemData = item.data;
                let currentCoursesListItem = listCourses[progress + index];
                let newCurrentTermSchedule = [];
                currentTerm = itemData[0].term;
                for (let section of itemData) {
                    newCurrentTermSchedule.push({
                        campus: section.campus,
                        class_number: section.class_number,
                        enrollment_capacity: section.enrollment_capacity,
                        enrollment_total: section.enrollment_total,
                        waiting_capacity: section.waiting_capacity,
                        waiting_total: section.waiting_total,
                        reserves: section.reserves,
                        classes: section.classes,
                        last_updated: section.last_updated
                    });
                }
                listNewCurrentTermSchedule.push({
                    find: {
                        course_id: currentCoursesListItem.course_id,
                        subject: currentCoursesListItem.subject,
                        catalog_number: currentCoursesListItem.catalog_number
                    },
                    data: newCurrentTermSchedule
                });
            }
            progress += options.batchSize;
        }
    };

    await requestInBatch();



    logger.info(`scrape_courses_schedule succeeded`);
};
